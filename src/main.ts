import { MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { escapeInvalidFileNameChars, removeFrontmatterBlock, trimForFileName } from "./utils";
import NoteSplitterSettingsTab from "./obsidian/note-splitter-settings-tab";

interface NoteSplitterSettings {
	saveFolderPath: string;
	useContentAsTitle: boolean;
	delimiter: string;
	appendToSplitContent: string;
	deleteOriginalNote: boolean;
}

const DEFAULT_SETTINGS: NoteSplitterSettings = {
	saveFolderPath: "note-splitter",
	useContentAsTitle: false,
	delimiter: "\\n",
	appendToSplitContent: "",
	deleteOriginalNote: false,
};

export default class NoteSplitterPlugin extends Plugin {
	settings: NoteSplitterSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new NoteSplitterSettingsTab(this.app, this));

		this.addCommand({
			id: "split-by-delimiter",
			name: "Split by delimiter",
			callback: async () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view === null) {
					new Notice("Please open a markdown note.");
					return;
				}

				const file = view.file;
				if (file === null) {
					new Notice("No file found for this note.");
					return;
				}

				if (view.getMode() !== 'source') {
					new Notice("Please switch to editing mode to split this note.");
					return;
				}

				this.splitNoteByDelimiter(file);
			},
		});
	}

	onunload() { }

	private async splitNoteByDelimiter(file: TFile,) {
		const { delimiter} = this.settings;

		//Obsidian will store `\n`` as `\\n` in the settings
		const escapedDelimiter = delimiter.replace(/\\n/g, "\n");

		if (escapedDelimiter === "") {
			new Notice("No delimiter set. Please set a delimiter in the settings.");
			return;
		}

		const data = await this.app.vault.cachedRead(file);

		const dataWithoutFrontmatter = removeFrontmatterBlock(data);
		if (dataWithoutFrontmatter === "") {
			new Notice("No content to split.");
			return;
		}

		const splitContent = dataWithoutFrontmatter
			.split(escapedDelimiter)
			.map((content) => content.trim())
			.filter((content) => content !== "");

		if (splitContent.length === 0) {
			new Notice("No content to split.");
			return;
		}

		if (splitContent.length === 1) {
			new Notice("Only one section of content found. Nothing to split.");
			return;
		}

		const { saveFolderPath } = this.settings;
		const folderPath =
			(saveFolderPath ||
			file.parent?.path) ?? "";

		try {
			await this.app.vault.createFolder(folderPath);
		} catch (err) {
			//Folder already exists
		}

		let filesCreated = 0;
		for (const [i, originalContent] of splitContent.entries()) {
			const { appendToSplitContent, useContentAsTitle } = this.settings;

			let updatedContent = originalContent;
			if (appendToSplitContent.length > 0) {
				updatedContent += appendToSplitContent;
			}

			let fileName = originalContent.split("\n")[0];
			if (useContentAsTitle) {
				fileName = escapeInvalidFileNameChars(fileName);
				fileName = trimForFileName(fileName, ".md");
			} else {
				fileName = `split-note-${Date.now() + i}`;
			}

			const filePath = normalizePath(`${folderPath}/${fileName}.md`);

			try {
				await this.app.vault.create(filePath, updatedContent);
				filesCreated++;
			} catch (err) {
				if (err.message.includes("already exists")) {
					const newFilePath = `${folderPath}/Split conflict ${crypto.randomUUID()}.md`;
					try {
						await this.app.vault.create(newFilePath, updatedContent);
						filesCreated++;
					} catch (err) {
						console.error(err);
						new Notice(`Error creating file: ${err.message}`);
					}
					continue;
				}
				new Notice(`Error creating file: ${err.message}`);
				console.log(err);
			}
		}

		if (filesCreated === splitContent.length && this.settings.deleteOriginalNote) {
			await this.app.vault.delete(file);
		}

		new Notice(
			"Split into " + filesCreated + " note" + (filesCreated > 1 ? "s" : "") + ".",
		);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
