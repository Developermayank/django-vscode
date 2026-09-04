import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import AdmZip = require('adm-zip');
import express = require('express');
import { AddressInfo } from 'net';

let serverInstance: any = null;
let allocatedPort: number = 0;

export function activate(context: vscode.ExtensionContext) {

    // 1. Initialize a tiny background server to map the global storage folder
    const app = express();
    const globalStorageUri = context.globalStorageUri;
    const docsDir = path.join(globalStorageUri.fsPath, 'django_docs');

    // Create directories if they don't exist
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
    }

    // Serve the django_docs folder statically
    app.use('/docs', express.static(docsDir));

    const server = app.listen(0, () => {
        const address = serverInstance.address() as AddressInfo;
        allocatedPort = address.port;
        console.log(`Django Docs server running locally on port ${allocatedPort}`);
    });
    serverInstance = server;

    // 2. Register the Search Django Docs Command
    let disposable = vscode.commands.registerCommand('djangoExtension.searchDocs', async () => {

        let selectedVersion: QuickPickItem | undefined;
        type QuickPickItem = vscode.QuickPickItem;

        // Modify the version options as array of dict with version value and label for display
        // use the quickpickitem type
        const versionOptions = [
            { label: 'dev', description: 'dev' },
            { label: '6.1', description: '6.1' },
            { label: '6.0', description: '6.0' },
            { label: '5.2', description: '5.2' },
            { label: '5.1', description: '5.1' },
            { label: '5.0', description: '5.0' },
            { label: '4.2', description: '4.2' },
            { label: '4.1', description: '4.1' },
            { label: '4.0', description: '4.0' },
            { label: 'Enter custom version', description: 'Enter custom version' }
        ] as QuickPickItem[];

        for (const version of versionOptions) {
            if (version.label !== 'Enter custom version' && fs.existsSync(path.join(docsDir, `django-docs-${version.label}-en`))) {
                version.description += ' (Installed)';
            }
        }

        selectedVersion = await vscode.window.showQuickPick(versionOptions, {
            placeHolder: 'Select the Django documentation version you want to look up',
            canPickMany: false
        });

        if (!selectedVersion) {
            return; // User cancelled
        }

        if (selectedVersion.label === 'Enter custom version') {
            const customVersion = await vscode.window.showInputBox({
                placeHolder: 'Enter a custom Django version',
                prompt: 'If you want to use a version not listed, enter it here'
            });
            if (customVersion) {
                selectedVersion.label = customVersion;
            } else {
                return; // User cancelled
            }
        }

        const versionDirName = `django-docs-${selectedVersion.label}-en`;
        const localDocsPath = path.join(docsDir, versionDirName);
        const indexHtmlPath = path.join(localDocsPath, 'index.html');

        // Check if documentation for this version already exists
        if (!fs.existsSync(indexHtmlPath)) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Downloading Django ${selectedVersion.label} Documentation...`,
                cancellable: false
            }, async (progress) => {
                try {
                    // Constructed Django Official Zip Link (Example structure)
                    // Official URL format: https://djangoproject.com
                    // https://media.djangoproject.com/docs/django-docs-6.1-en.zip
                    const downloadUrl = `https://media.djangoproject.com/docs/${versionDirName}.zip`;
                    console.log(`Downloading from: ${downloadUrl}`);
                    const zipPath = path.join(docsDir, `${selectedVersion.label}.zip`);

                    // Fetch Zip File Stream
                    const response = await axios({
                        url: downloadUrl,
                        method: 'GET',
                        responseType: 'stream'
                    });
                    console.log("Download started...");

                    const writer = fs.createWriteStream(zipPath);
                    response.data.pipe(writer);

                    await new Promise<void>((resolve, reject) => {
                        writer.on('finish', () => resolve());
                        writer.on('error', reject);
                    });

                    // Extract the zip archive
                    progress.report({ message: "Extracting documentation..." });
                    const zip = new AdmZip(zipPath);
                    zip.extractAllTo(localDocsPath, true);
                    progress.report({ message: `Extracted to ${localDocsPath}...` });
                    console.log(`Extracted Django ${selectedVersion.label} docs to ${localDocsPath}`);
                    // After installation, notify the user
                    vscode.window.showInformationMessage(`Django ${selectedVersion.label} documentation downloaded and ready!`);
                    // Delete raw zip to optimize storage allocation
                    fs.unlinkSync(zipPath);

                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to fetch Django docs: ${error.message}`);
                    throw error;
                }
            });
        }

        // 3. Command Palette triggers VS Code Integrated Native Browser
        // Construct targeted URL leading back to the extension background server
        const localTargetUrl = `http://localhost:${allocatedPort}/docs/${versionDirName}/`;

        try {
            // Fires up the core VS Code Integrated Web Panel
            await vscode.commands.executeCommand('browser.open', localTargetUrl);
        } catch {
            // Fallback for older VS Code environment versions
            await vscode.commands.executeCommand('simpleBrowser.show', localTargetUrl);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    if (serverInstance) {
        serverInstance.close();
    }
}
