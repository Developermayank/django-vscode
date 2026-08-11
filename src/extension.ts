import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import extractZip = require('extract-zip');

const VERSIONS = [
    'dev',
    '6.1',
    '6.0',
    '5.2',
    '5.1',
    '5.0',
    '4.2',
    '4.1',
    '4.0'
] as const;

type DjangoVersion = typeof VERSIONS[number];

const DEFAULT_VERSION: DjangoVersion = '6.1';

const DOCS_URL =
    'https://media.djangoproject.com/docs/django-docs-{version}-en.zip';

export function activate(
    context: vscode.ExtensionContext
) {
    const disposable = vscode.commands.registerCommand(
        'myExtension.djangodocs',
        async () => {
            await openDjangoDocs(context, DEFAULT_VERSION);
        }
    );

    context.subscriptions.push(disposable);
}

async function openDjangoDocs(
    context: vscode.ExtensionContext,
    version: DjangoVersion
) {
    try {
        const docsRoot = await ensureDocumentation(
            context,
            version
        );

        const indexPath = path.join(
            docsRoot,
            'index.html'
        );

        if (!fs.existsSync(indexPath)) {
            throw new Error(
                'index.html was not found after extracting the Django documentation.'
            );
        }

        const panel = vscode.window.createWebviewPanel(
            'djangoDocs',
            'Django Documentation ' + version,
            vscode.ViewColumn.One,
            {
                enableScripts: true,

                localResourceRoots: [
                    vscode.Uri.file(docsRoot)
                ]
            }
        );

        let currentFile = indexPath;

        panel.webview.onDidReceiveMessage(
            async message => {
                if (
                    message.type === 'openInternal' &&
                    typeof message.href === 'string'
                ) {
                    const result = resolveLocalDjangoLink(
                        message.href,
                        currentFile,
                        docsRoot
                    );

                    if (!result) {
                        vscode.window.showWarningMessage(
                            'Invalid documentation link: ' +
                            message.href
                        );

                        return;
                    }

                    currentFile = result.filePath;

                    loadDocument(
                        panel,
                        currentFile,
                        docsRoot,
                        result.fragment
                    );

                    return;
                }

                if (
                    message.type === 'openExternal' &&
                    typeof message.href === 'string'
                ) {
                    await openExternal(
                        message.href
                    );
                }
            },
            undefined,
            context.subscriptions
        );

        loadDocument(
            panel,
            indexPath,
            docsRoot
        );

    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : String(error);

        vscode.window.showErrorMessage(
            'Unable to load Django documentation: ' + message
        );
    }
}

function resolveLocalDjangoLink(
    href: string,
    currentFile: string,
    docsRoot: string
): {
    filePath: string;
    fragment: string;
} | undefined {
    let value = href.trim();

    if (!value) {
        return undefined;
    }

    /*
     * Fragment-only link:
     *
     * #models
     */
    if (value.startsWith('#')) {
        return {
            filePath: currentFile,
            fragment: value.substring(1)
        };
    }

    /*
     * Separate #fragment.
     */
    const fragmentIndex =
        value.indexOf('#');

    let linkPath = value;
    let fragment = '';

    if (fragmentIndex !== -1) {
        linkPath =
            value.substring(
                0,
                fragmentIndex
            );

        fragment =
            value.substring(
                fragmentIndex + 1
            );
    }

    /*
     * Remove query parameters.
     */
    const queryIndex =
        linkPath.indexOf('?');

    if (queryIndex !== -1) {
        linkPath =
            linkPath.substring(
                0,
                queryIndex
            );
    }

    if (!linkPath) {
        return {
            filePath: currentFile,
            fragment
        };
    }

    const decoded =
        decodeSafe(linkPath);

    if (!decoded) {
        return undefined;
    }

    let target: string;

    /*
     * Django documentation can contain
     * root-relative paths such as:
     *
     * /topics/install/
     */
    if (decoded.startsWith('/')) {
        target = path.resolve(
            docsRoot,
            '.' + decoded
        );
    } else {
        /*
         * Normal relative link:
         *
         * ../topics/install/
         */
        target = path.resolve(
            path.dirname(currentFile),
            decoded
        );
    }

    /*
     * Security check.
     */
    if (
        !isInside(
            target,
            docsRoot
        )
    ) {
        return undefined;
    }

    const filePath =
        resolvePage(target);

    if (!filePath) {
        return undefined;
    }

    return {
        filePath,
        fragment
    };
}

async function ensureDocumentation(
    context: vscode.ExtensionContext,
    version: DjangoVersion
): Promise<string> {
    const storageRoot =
        context.globalStorageUri.fsPath;

    const docsRoot = path.join(
        storageRoot,
        'docs',
        'django-docs-' + version + '-en'
    );

    const indexPath = path.join(
        docsRoot,
        'index.html'
    );

    // Already downloaded.
    if (fs.existsSync(indexPath)) {
        return docsRoot;
    }

    const downloadsRoot = path.join(
        storageRoot,
        'downloads'
    );

    await fs.promises.mkdir(
        downloadsRoot,
        { recursive: true }
    );

    await fs.promises.mkdir(
        path.join(storageRoot, 'docs'),
        { recursive: true }
    );

    const zipPath = path.join(
        downloadsRoot,
        'django-docs-' + version + '-en.zip'
    );

    const url = DOCS_URL.replace(
        '{version}',
        version
    );

    await vscode.window.withProgress(
        {
            location:
                vscode.ProgressLocation.Notification,

            title:
                'Downloading Django ' + version + ' documentation',

            cancellable: false
        },
        async progress => {
            if (!fs.existsSync(zipPath)) {
                progress.report({
                    message: 'Downloading...'
                });

                await downloadFile(
                    url,
                    zipPath
                );
            }

            progress.report({
                message: 'Extracting...'
            });

            const tempRoot =
                docsRoot + '.tmp';

            await fs.promises.rm(
                tempRoot,
                {
                    recursive: true,
                    force: true
                }
            );

            await fs.promises.mkdir(
                tempRoot,
                { recursive: true }
            );

            try {
                await extractZip(
                    zipPath,
                    {
                        dir: tempRoot
                    }
                );

                const extractedRoot =
                    findDocsRoot(
                        tempRoot,
                        version
                    );

                if (!extractedRoot) {
                    throw new Error(
                        'The downloaded ZIP does not contain index.html.'
                    );
                }

                await fs.promises.rm(
                    docsRoot,
                    {
                        recursive: true,
                        force: true
                    }
                );

                await fs.promises.rename(
                    extractedRoot,
                    docsRoot
                );

                await fs.promises.rm(
                    tempRoot,
                    {
                        recursive: true,
                        force: true
                    }
                );

            } catch (error) {
                await fs.promises.rm(
                    tempRoot,
                    {
                        recursive: true,
                        force: true
                    }
                );

                throw error;
            }
        }
    );

    return docsRoot;
}

function findDocsRoot(
    tempRoot: string,
    version: DjangoVersion
): string | undefined {
    const expected = path.join(
        tempRoot,
        'django-docs-' + version + '-en'
    );

    if (
        fs.existsSync(
            path.join(expected, 'index.html')
        )
    ) {
        return expected;
    }

    // Some ZIP layouts may put index.html directly
    // at the root.
    if (
        fs.existsSync(
            path.join(tempRoot, 'index.html')
        )
    ) {
        return tempRoot;
    }

    // Look one level down.
    const entries = fs.readdirSync(
        tempRoot,
        {
            withFileTypes: true
        }
    );

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const candidate = path.join(
            tempRoot,
            entry.name
        );

        if (
            fs.existsSync(
                path.join(candidate, 'index.html')
            )
        ) {
            return candidate;
        }
    }

    return undefined;
}

function downloadFile(
    url: string,
    destination: string
): Promise<void> {
    return new Promise(
        (resolve, reject) => {
            const request = https.get(
                url,
                response => {
                    // Follow redirects.
                    if (
                        response.statusCode &&
                        response.statusCode >= 300 &&
                        response.statusCode < 400 &&
                        response.headers.location
                    ) {
                        response.resume();

                        const redirectUrl =
                            new URL(
                                response.headers.location,
                                url
                            ).toString();

                        downloadFile(
                            redirectUrl,
                            destination
                        )
                            .then(resolve)
                            .catch(reject);

                        return;
                    }

                    if (response.statusCode !== 200) {
                        response.resume();

                        reject(
                            new Error(
                                'HTTP ' +
                                response.statusCode +
                                ' while downloading documentation.'
                            )
                        );

                        return;
                    }

                    const file =
                        fs.createWriteStream(
                            destination
                        );

                    response.pipe(file);

                    file.on(
                        'finish',
                        () => {
                            file.close(() => {
                                resolve();
                            });
                        }
                    );

                    file.on(
                        'error',
                        error => {
                            file.destroy();

                            reject(error);
                        }
                    );

                    response.on(
                        'error',
                        error => {
                            file.destroy();

                            reject(error);
                        }
                    );
                }
            );

            request.on(
                'error',
                error => {
                    reject(error);
                }
            );
        }
    );
}

function loadDocument(
    panel: vscode.WebviewPanel,
    filePath: string,
    docsRoot: string,
    fragment?: string
) {
    try {
        let html = fs.readFileSync(
            filePath,
            'utf8'
        );

        html = rewriteResources(
            panel.webview,
            html,
            path.dirname(filePath),
            docsRoot
        );

        html = injectNavigationScript(html);

        if (fragment) {
            html = injectFragmentScript(
                html,
                fragment
            );
        }

        panel.webview.html = html;
    } catch (error) {
        console.error(error);

        panel.webview.html =
            '<h2>Unable to load documentation</h2>';
    }
}

function rewriteResources(
    webview: vscode.Webview,
    html: string,
    currentDirectory: string,
    docsRoot: string
): string {
    /*
     * src:
     *
     * <script src="...">
     * <img src="...">
     * <iframe src="...">
     *
     * poster:
     *
     * <video poster="...">
     */
    html = html.replace(
        /(\b(?:src|poster)\s*=\s*)(["'])([^"']+)\2/gi,
        (
            match,
            prefix,
            quote,
            value
        ) => {
            return rewriteResource(
                match,
                prefix,
                quote,
                value,
                webview,
                currentDirectory,
                docsRoot
            );
        }
    );

    /*
     * Only rewrite href attributes belonging
     * to <link> tags.
     *
     * NEVER rewrite <a href>.
     */
    html = html.replace(
        /<link\b[^>]*>/gi,
        tag => {
            return tag.replace(
                /(\bhref\s*=\s*)(["'])([^"']+)\2/i,
                (
                    match,
                    prefix,
                    quote,
                    value
                ) => {
                    return rewriteResource(
                        match,
                        prefix,
                        quote,
                        value,
                        webview,
                        currentDirectory,
                        docsRoot
                    );
                }
            );
        }
    );

    return html;
}

function rewriteResource(
    original: string,
    prefix: string,
    quote: string,
    value: string,
    webview: vscode.Webview,
    currentDirectory: string,
    docsRoot: string
): string {
    const resource =
        value.trim();

    if (
        resource.startsWith('#') ||
        resource.startsWith('data:') ||
        resource.startsWith('javascript:') ||
        resource.startsWith('mailto:')
    ) {
        return original;
    }

    const parts =
        splitSuffix(resource);

    const decoded =
        decodeSafe(parts.path);

    if (!decoded) {
        return original;
    }

    const diskPath =
        path.resolve(
            currentDirectory,
            decoded
        );

    if (
        !isInside(
            diskPath,
            docsRoot
        )
    ) {
        return original;
    }

    if (
        !fs.existsSync(diskPath)
    ) {
        return original;
    }

    const uri =
        webview.asWebviewUri(
            vscode.Uri.file(
                diskPath
            )
        );

    return (
        prefix +
        quote +
        uri.toString() +
        parts.suffix +
        quote
    );
}



function resolvePage(
    target: string
): string | undefined {
    const candidates = [
        target,
        target + '.html',
        path.join(target, 'index.html')
    ];

    for (const candidate of candidates) {
        if (
            fs.existsSync(candidate) &&
            fs.statSync(candidate).isFile()
        ) {
            return candidate;
        }
    }

    return undefined;
}

function injectNavigationScript(
    html: string
): string {
    const script = [
        '<script>',
        '(function () {',

        'const vscode = acquireVsCodeApi();',

        "document.addEventListener('click', function(event) {",

        'const target = event.target;',

        'if (!(target instanceof Element)) {',
        'return;',
        '}',

        "const link = target.closest('a');",

        'if (!link) {',
        'return;',
        '}',

        "const href = link.getAttribute('href');",

        'if (!href) {',
        'return;',
        '}',

        /*
         * Let normal browser behavior handle things
         * that aren't documentation links.
         */
        "if (href.startsWith('javascript:')) {",
        'return;',
        '}',

        'event.preventDefault();',

        'vscode.postMessage({',
        "type: 'openInternal',",
        'href: href',
        '});',

        '});',

        '})();',
        '</script>'
    ].join('\n');

    return html.replace(
        /<\/body>/i,
        script + '</body>'
    );
}

function injectFragmentScript(
    html: string,
    fragment: string
): string {
    const safe =
        JSON.stringify(fragment);

    const script = [
        '<script>',
        '(function () {',
        'const fragment = ' +
        safe + ';',

        "window.addEventListener('DOMContentLoaded', function() {",

        'const element = document.getElementById(fragment);',

        'if (element) {',
        'element.scrollIntoView();',
        '}',

        '});',
        '})();',
        '</script>'
    ].join('\n');

    return html.replace(
        /<\/body>/i,
        script + '</body>'
    );
}

async function openExternal(
    href: string
) {
    try {
        const uri =
            vscode.Uri.parse(href);

        if (
            uri.scheme !== 'http' &&
            uri.scheme !== 'https' &&
            uri.scheme !== 'mailto'
        ) {
            return Promise.resolve(false);
        }

        return vscode.env.openExternal(uri);
    } catch {
        return Promise.resolve(false);
    }
}

function splitFragment(
    value: string
): {
    path: string;
    fragment: string;
} {
    const index =
        value.indexOf('#');

    if (index === -1) {
        return {
            path: value,
            fragment: ''
        };
    }

    return {
        path: value.substring(0, index),
        fragment: value.substring(index + 1)
    };
}

function splitSuffix(
    value: string
): {
    path: string;
    suffix: string;
} {
    const index =
        value.search(/[?#]/);

    if (index === -1) {
        return {
            path: value,
            suffix: ''
        };
    }

    return {
        path: value.substring(0, index),
        suffix: value.substring(index)
    };
}

function decodeSafe(
    value: string
): string | undefined {
    try {
        return decodeURIComponent(value);
    } catch {
        return undefined;
    }
}

function isInside(
    target: string,
    root: string
): boolean {
    const normalizedTarget =
        path.resolve(target);

    const normalizedRoot =
        path.resolve(root);

    return (
        normalizedTarget === normalizedRoot ||
        normalizedTarget.startsWith(
            normalizedRoot + path.sep
        )
    );
}

export function deactivate() { }