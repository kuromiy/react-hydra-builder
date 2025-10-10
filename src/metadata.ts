import { writeFile } from "node:fs/promises";
import { basename, relative } from "node:path";
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
	outputPath = "./build/metadata.json",
): Promise<void> {
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
	private static metadata: ComponentMetadata | null = null;

	/**
	 * メタデータを読み込み
	 */
	static async loadMetadata(
		metadataPath = "./build/metadata.json",
	): Promise<void> {
		if (!ComponentResolver.metadata) {
			try {
				const { readFile } = await import("node:fs/promises");
				const metadataContent = await readFile(metadataPath, "utf8");
				ComponentResolver.metadata = JSON.parse(metadataContent);
			} catch (error) {
				console.warn("メタデータの読み込みに失敗しました:", error);
				ComponentResolver.metadata = {};
			}
		}
	}

	/**
	 * コンポーネント名からスクリプトパスを解決
	 */
	static async resolveScriptPath(componentName: string): Promise<string> {
		await ComponentResolver.loadMetadata();

		const componentMeta = ComponentResolver.metadata?.[componentName];
		if (componentMeta) {
			return componentMeta.scriptFileName;
		}

		// フォールバック: 従来の命名規則
		console.warn(
			`コンポーネント ${componentName} のメタデータが見つかりません`,
		);
		return `${componentName.toLowerCase().replace(/page$/, "")}.page.js`;
	}

	/**
	 * メタデータをクリア（テスト用）
	 */
	static clearCache(): void {
		ComponentResolver.metadata = null;
	}
}
