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
import { readFiles } from "./utils.js";

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
};

/**
 * ビルド処理を実行する関数
 * @returns Promise<void>
 */
export async function build({
	buildTargetDir,
	buildTargetFileSuffix,
	outputDir,
}: PageBuildConfig): Promise<void> {
	const files = await readFiles(buildTargetDir, buildTargetFileSuffix);
	const processes = files.map((file) =>
		_build(outputDir, buildTargetFileSuffix, file),
	);
	await Promise.all(processes);
}

async function _build(
	_targetDir: string,
	targetFileSuffix: string,
	path: string,
) {
	// プロジェクトルートからの相対パスを計算
	const importPath = `./${relative(".", path).replace(/\\/g, "/")}`;
	const outFile = toOutFile(path, targetFileSuffix);
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

export function toOutFile(path: string, suffix: string) {
	const fileName = basename(path);
	// .page.tsxを除去して、.page.jsを追加
	const name = fileName.replace(suffix, "");
	return `./public/js/${name}page.js`;
}

/**
 * ウォッチビルド処理を実行する関数
 * @returns Promise<void>
 */
export async function watchBuild({
	buildTargetDir,
	buildTargetFileSuffix,
	outputDir,
}: PageBuildConfig): Promise<void> {
	// 初回ビルド
	await build({ buildTargetDir, buildTargetFileSuffix, outputDir });

	// 監視開始
	watch(buildTargetDir, { recursive: true }, async (eventType, filename) => {
		if (!filename) {
			return;
		}

		// ロック取得
		using locked = lock(filename);
		if (!locked.isLock) {
			return;
		}

		// フォルダまたは削除された場合は何もしない
		const fullPath = join(buildTargetDir, filename);
		const stats = statSync(fullPath, { throwIfNoEntry: false });

		// 削除の場合、public/js/に出力されたファイルも削除する
		if (!stats) {
			deleteBuildedPageJsFile(filename);
			return;
		}

		// ビルド不要の場合は何もしない
		if (!isBuild(eventType, filename, stats, buildTargetFileSuffix)) {
			return;
		}

		await _build(outputDir, buildTargetFileSuffix, fullPath);
	});
}

function deleteBuildedPageJsFile(fileName: string) {
	const path = `./public/js/${fileName}`.replace("tsx", "js");
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
	// フォルダの場合はビルド不要
	if (stats.isDirectory()) {
		return false;
	}

	// renameの場合、新規or削除になりビルド不要
	if (eventType === "rename") {
		console.debug("is build rename", fileName, eventType);
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
