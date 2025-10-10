/**
 * コンポーネントメタデータの型定義
 */
export interface ComponentMetadata {
	[componentName: string]: {
		/** スクリプトファイル名 */
		scriptFileName: string;
		/** 元のファイルパス（プロジェクトルートからの相対パス） */
		originalPath: string;
		/** 出力ファイルパス */
		outputPath: string;
	};
}

/**
 * ブラウザ側のグローバルオブジェクト拡張
 */
// declare global {
// 	interface Window {
// 		__HYDRA_META__?: Record<
// 			string,
// 			{
// 				scriptPath: string;
// 				originalPath: string;
// 				componentName: string;
// 			}
// 		>;
// 		__SERVER_DATA__?: Record<string, unknown>;
// 	}
// }
