import {
	rm,
	type Stats,
	statSync,
	unlink,
	type WatchEventType,
	watch,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { format } from "node:util";
import * as esbuild from "esbuild";
import {
	ComponentResolver,
	extractComponentName,
	generateMetadataFile,
	toScriptFileName,
	toScriptPath,
} from "./metadata.js";
import type { ComponentMetadata } from "./types.js";
import { readFiles } from "./utils.js";

// エクスポート
export {
	ComponentResolver,
	generateMetadataFile,
	extractComponentName,
	toScriptFileName,
	toScriptPath,
};
export type { ComponentMetadata };

const TEMPLATE = `
import React from "react";
import { hydrateRoot } from "react-dom/client";
import Page from "./%s";

hydrateRoot(
    document.getElementById("app"),
    <Page {...window.__SERVER_DATA__} />,
);
`;

type PageBuildConfig = {
	/**
	 * ビルド対象のディレクトリ
	 */
	buildTargetDir: string;
	/**
	 * ビルド対象のファイルのサフィックス
	 */
	buildTargetFileSuffix: string;
	/**
	 * 出力先ディレクトリ
	 */
	outputDir: string;
	/**
	 * メタデータファイルの出力先パス
	 */
	metadataPath: string;
};

/**
 * ビルド処理を実行する関数
 * @returns Promise<void>
 */
export async function build({
	buildTargetDir,
	buildTargetFileSuffix,
	outputDir,
	metadataPath,
}: PageBuildConfig): Promise<void> {
	const files = await readFiles(buildTargetDir, buildTargetFileSuffix);

	// 1. メタデータ収集
	const metadata: ComponentMetadata = {};

	const processes = files.map(async (file) => {
		const componentName = extractComponentName(file);
		const scriptFileName = toScriptFileName(file, buildTargetFileSuffix);
		const relativePath = relative(buildTargetDir, file);

		metadata[componentName] = {
			scriptFileName,
			originalPath: relativePath,
			outputPath: toScriptPath(outputDir, file, buildTargetFileSuffix),
		};

		return _build(outputDir, buildTargetFileSuffix, file);
	});

	await Promise.all(processes);

	// 2. メタデータファイル生成
	await generateMetadataFile(metadata, metadataPath);
}

async function _build(
	targetDir: string,
	targetFileSuffix: string,
	path: string,
) {
	// プロジェクトルートからの相対パスを計算
	const importPath = `./${relative(".", path).replace(/\\/g, "/")}`;
	const outFile = toOutFile(targetDir, path, targetFileSuffix);

	await esbuild.build({
		stdin: {
			contents: format(TEMPLATE, importPath),
			resolveDir: ".", // プロジェクトルート
			loader: "tsx",
		},
		bundle: true,
		outfile: outFile,
		platform: "browser",
	});
}

function toOutFile(dir: string, path: string, suffix: string) {
	const fileName = basename(path);
	// .page.tsxを除去して、.page.jsを追加
	const name = fileName.replace(suffix, "");
	return `${dir}/${name}page.js`;
}

/**
 * ウォッチビルド処理を実行する関数
 * @returns Promise<void>
 */
export async function watchBuild({
	buildTargetDir,
	buildTargetFileSuffix,
	outputDir,
	metadataPath,
}: PageBuildConfig): Promise<void> {
	// 初回ビルド（メタデータも生成される）
	const files = await readFiles(buildTargetDir, buildTargetFileSuffix);

	// メタデータをメモリ上に保持
	const metadata: ComponentMetadata = {};
	for (const file of files) {
		const componentName = extractComponentName(file);
		const scriptFileName = toScriptFileName(file, buildTargetFileSuffix);
		const relativePath = relative(buildTargetDir, file);

		metadata[componentName] = {
			scriptFileName,
			originalPath: relativePath,
			outputPath: toScriptPath(outputDir, file, buildTargetFileSuffix),
		};
	}

	// 初回ビルド
	await build({
		buildTargetDir,
		buildTargetFileSuffix,
		outputDir,
		metadataPath,
	});

	// 監視開始
	watch(buildTargetDir, { recursive: true }, async (eventType, filename) => {
		if (!filename) {
			return;
		}

		// ロック取得
		const locked = lock(filename);
		if (!locked.isLock) {
			return;
		}

		try {
			// フォルダまたは削除された場合は何もしない
			const fullPath = join(buildTargetDir, filename);
			const stats = statSync(fullPath, { throwIfNoEntry: false });

			// 削除の場合、public/js/に出力されたファイルも削除する
			if (!stats) {
				// ビルド対象ファイルが削除された場合、メタデータからも削除
				if (filename.endsWith(buildTargetFileSuffix)) {
					const componentName = extractComponentName(fullPath);
					if (metadata[componentName]) {
						delete metadata[componentName];
						// メタデータファイルを更新
						await generateMetadataFile(metadata, metadataPath);
						console.log(`メタデータから削除: ${componentName}`);
					}
				}
				deleteBuildedPageJsFile(fullPath, buildTargetFileSuffix, outputDir);
				return;
			}

			// ビルド不要の場合は何もしない
			if (!isBuild(eventType, filename, stats, buildTargetFileSuffix)) {
				return;
			}

			// ファイルをビルド
			await _build(outputDir, buildTargetFileSuffix, fullPath);

			// 新規ファイルの場合、メタデータに追加
			const componentName = extractComponentName(fullPath);
			if (!metadata[componentName]) {
				const scriptFileName = toScriptFileName(
					fullPath,
					buildTargetFileSuffix,
				);
				const relativePath = relative(buildTargetDir, fullPath);

				metadata[componentName] = {
					scriptFileName,
					originalPath: relativePath,
					outputPath: toScriptPath(outputDir, fullPath, buildTargetFileSuffix),
				};

				// メタデータファイルを更新
				await generateMetadataFile(metadata, metadataPath);
				console.log(`メタデータに追加: ${componentName}`);
			}
		} finally {
			locked[Symbol.dispose]();
		}
	});
}

function deleteBuildedPageJsFile(
	filePath: string,
	buildTargetFileSuffix: string,
	outputDir: string,
) {
	const path = toOutFile(outputDir, filePath, buildTargetFileSuffix);
	const stats = statSync(path, { throwIfNoEntry: false });
	if (!stats) {
		// 削除対象なし
		return;
	}
	// パス種別(フォルダ/ファイル)にあった削除実施
	if (stats.isDirectory()) {
		rm(path, { recursive: true }, (err) => {
			if (err) {
				console.error(`Directory Delete Error: ${err.message}`);
				return;
			}
			console.info(`File Deleted: ${path}`);
		});
	} else {
		unlink(path, (err) => {
			if (err) {
				console.info(`File Delete Error: ${err.message}`);
				return;
			}
			console.info(`File Deleted: ${path}`);
		});
	}
}

function isBuild(
	eventType: WatchEventType,
	fileName: string,
	stats: Stats,
	buildTargetFileSuffix: string,
) {
	// statsがundefinedの場合はファイルが削除されたとみなす
	if (!stats) {
		console.debug("is build: file deleted or missing", fileName, eventType);
		return false;
	}

	// フォルダの場合はビルド不要
	if (stats.isDirectory()) {
		return false;
	}

	// ビルド対象かどうか判定
	if (!fileName.endsWith(buildTargetFileSuffix)) {
		console.debug("is build not tsx", fileName, eventType);
		return false;
	}

	return true;
}

// ロック
const lockMap = new Map<string, boolean>();
function lock(fileName: string) {
	const isLock = lockMap.get(fileName);
	// true の場合まだビルド中だからロックをとれない
	if (isLock) {
		return {
			isLock: false,
			// 別でビルド中なのでlockMapは更新しない
			[Symbol.dispose]: () => {
				console.debug("non update lockMap.");
			},
		};
	}
	// ロックを取得
	lockMap.set(fileName, true);
	return {
		isLock: true,
		[Symbol.dispose]: () => {
			console.debug("update lockMap.");
			lockMap.set(fileName, false);
		},
	};
}
