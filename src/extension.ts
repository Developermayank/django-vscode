// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// import { registerIntelligence } from './extension/features/codeCompletion/register-intelligence';
// import { registerCacheCommand } from './extension/features/cache-operation';
// import { registerCallbackRequest } from './extension/features/register-callback-request';
import { registerCommands } from './extension/features/register-commands';
// import { registerDevToolCommand } from './extension/features/register-dev-tool';
// import { registerWelcomeMessage } from './extension/features/register-welcome-message';
// import { CustomEvent } from './extension/views/custom-event';
// import { registerCenterPanel } from './extension/views/register-center-panel';
// import { registerWebViewProvider } from "./extension/views/register-webview-provider";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "django-vscode" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	// const disposable = vscode.commands.registerCommand('django-vscode.helloWorld', () => {
	// 	// The code you place here will be executed every time your command is executed
	// 	// Display a message box to the user
	// 	vscode.window.showInformationMessage('Hello World from Django!');
	// });

	// context.subscriptions.push(disposable);

	const op = vscode.window.createOutputChannel('Django');
	registerCommands(context, op);
	// registerCacheCommand(context);
	// registerWelcomeMessage(context);
	// registerWebViewProvider(context, op);
	// registerDevToolCommand(context);
	// registerCallbackRequest(context);
	// registerCenterPanel(context);
	// registerIntelligence(context);
	// vscode.commands.executeCommand('setContext', 'isPrintContextMenu', true);

	// CustomEvent.customEvent.subscribe(data => vscode.window.showInformationMessage('Message from event: ' + data));
}

// This method is called when your extension is deactivated
export function deactivate() { }