import * as vscode from "vscode";
import * as path from 'path'
import * as fs from 'fs'


export function registerCommands(context: vscode.ExtensionContext, op: vscode.OutputChannel) {
    context.subscriptions.push(vscode.commands.registerCommand('django-vscode.create-django-app', () => {
        vscode.window.showInputBox({ title: "Enter the name of django app?" })
            .then(result => createDjangoApp(result));
    }));

    context.subscriptions.push(vscode.commands.registerCommand('django-vscode.open-documentation', () => {
        const panel = vscode.window.createWebviewPanel(
            'djangoDocs',
            "Django Documentation",
            vscode.ViewColumn.One, {}
        );
        const docPath = vscode.Uri.file(path.join(context.extensionPath, "docs", "index.html"));
        const pathUri = docPath.with({ scheme: 'vscode-resource' });
        panel.webview.html = fs.readFileSync(pathUri.fsPath, "utf8")
    }));

}

function createDjangoApp(result: string | undefined): any {
    console.log("App is created: " + result);
}