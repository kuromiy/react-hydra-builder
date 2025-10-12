import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import type { ComponentMetadata } from "./types.js";

/**
 * ファイルパスからコンポーネント名を抽出
 */
export function extractComponentName(filePath: string): string {
	const fileName = basename(filePath);
	// .page.tsx → .page を除去
	const baseName = fileName.replace(/\.page\.(tsx|ts)$/, "");

	// ドット記法、kebab-case、snake_case をPascalCaseに変換
	// 例: video.register → VideoRegister
	// 例: user-profile → UserProfile
	// 例: admin_dashboard → AdminDashboard
	return `${baseName
		.split(/[.\-_]/) // ドット、ハイフン、アンダースコアで分割
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join("")}Page`;
}

/**
 * コンポーネント名からスクリプトファイル名を生成
 */
export function toScriptFileName(filePath: string, suffix: string): string {
	const fileName = basename(filePath);
	// .page.tsxを除去して、.page.jsを追加
	const name = fileName.replace(suffix, "");
	return `${name}page.js`;
}

/**
 * ファイルパスから出力パスの算出
 */
export function toScriptPath(
	outputDir: string,
	originalPath: string,
	suffix: string,
): string {
	// ディレクトリ構造を保持してパスを生成
	const relativePath = relative(".", originalPath);
	const pathWithoutExt = relativePath.replace(suffix, "");
	return `${outputDir}/${pathWithoutExt}page.js`;
}

/**
 * メタデータファイルを生成
 */
export async function generateMetadataFile(
	metadata: ComponentMetadata,
	outputPath: string,
): Promise<void> {
	// 出力先ディレクトリを作成
	const dir = dirname(outputPath);
	await mkdir(dir, { recursive: true });

	// メタデータファイルを書き込み
	const content = JSON.stringify(metadata, null, 2);
	await writeFile(outputPath, content, "utf8");
	console.log(
		`メタデータファイルを生成しました: ${Object.keys(metadata).length}件`,
	);
}

/**
 * ComponentResolver クラス
 * サーバーサイドでのスクリプトパス解決用
 */
// biome-ignore lint/complexity/noStaticOnlyClass: API consistency and future extensibility
export class ComponentResolver {
	/**
	 * メタデータを読み込み
	 */
	static async loadMetadata(metadataPath: string): Promise<ComponentMetadata> {
		try {
			const { readFile } = await import("node:fs/promises");
			const metadataContent = await readFile(metadataPath, "utf8");
			return JSON.parse(metadataContent);
		} catch (error) {
			console.warn("メタデータの読み込みに失敗しました:", error);
			return {};
		}
	}

	/**
	 * コンポーネント名からスクリプトパスを解決
	 */
	static async resolveScriptPath(
		componentName: string,
		metadataPath: string,
	): Promise<string> {
		const metadata = await ComponentResolver.loadMetadata(metadataPath);

		const componentMeta = metadata[componentName];
		if (componentMeta) {
			return componentMeta.scriptFileName;
		}

		// メタデータが見つからない場合はエラーを投げる
		throw new Error(
			`コンポーネント "${componentName}" のメタデータが見つかりません。` +
				`ビルドが完了していることを確認してください。`,
		);
	}
}
