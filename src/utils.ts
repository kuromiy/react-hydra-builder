import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function readFiles(path: string, suffix: string) {
	const files = await readdir(path, { recursive: true, withFileTypes: true });
	return files
		.filter((file) => file.isFile() && file.name.endsWith(suffix))
		.map((file) => join(file.parentPath, file.name));
}
