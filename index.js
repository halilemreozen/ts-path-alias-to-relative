import chalk from 'chalk';
import fs from 'fs';
import glob from 'glob';
import jsoncParser from 'jsonc-parser';
import path from 'path';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import readline from 'readline';

export const cliOptions = { tsconfigPath: null, targetGlob: null, excludeAlias: null, excludeGlob: null, verbose: true, dry: true };

export function init() {
    const argv = yargs(hideBin(process.argv))
        .option('tsconfig', {
            alias: 't',
            type: 'string',
            description: '[Required] Path to tsconfig file, e.g. tsconfig.json',
        })
        .option('target', {
            alias: 'g',
            type: 'string',
            description: '[Required] Glob pattern to target files, e.g. **/*.{ts,tsx,js,jsx}',
            default: '**/*.{ts,tsx,js,jsx}'
        })
        .option('exclude', {
            alias: 'e',
            type: 'string',
            description: '[Optional] Glob pattern to exclude files from processing, e.g. **/node_modules/**',
            default: '**/node_modules/**'
        })
        .option('exclude-alias', {
            alias: 'a',
            type: 'string',
            description: '[Optional] Comma separated list of typescript alias to exclude from processing, e.g. -a=@my-comp/some-alias,@some-package-name',
        })
        .option('verbose', {
            alias: 'v',
            type: 'boolean',
            description: '[Optional] Enable verbose logging, e.g. -v or --verbose',
        })
        .option('dry', {
            alias: 'd',
            type: 'boolean',
            description: '[Optional] Dry-run mode to preview changes without writing to files, e.g. -d or --dry',
        })
        .argv;

    const verbose = argv.verbose;
    const dry = argv.dry;

    verboseLog(chalk.blue('Using verbose mode...'), 'info');
    dry && console.log(chalk.blue('Using dry-run mode...'));

    const excludeAlias = argv.excludeAlias ? argv.excludeAlias.split(',') : [];
    const tsconfigPath = getGivenOrDefaultTsConfigPath(argv.tsconfig);
    const targetGlob = getGivenOrDefaultFileGlob(argv.target, 'target');
    const excludeGlob = getGivenOrDefaultFileGlob(argv.exclude, 'exclude');

    if (!tsconfigPath || !targetGlob) {
        process.exit(1);
    }

    return { tsconfigPath, targetGlob, excludeAlias, excludeGlob, verbose, dry };
}

export function verboseLog(message, logType = 'log') {
    cliOptions.verbose && console[logType](message);
}

// Check if user provide a valid tsconfig path or if default tsconfig paths exist
export function getGivenOrDefaultTsConfigPath(argsTsConfig) {
    if (argsTsConfig) {
        if (fs.existsSync(argsTsConfig)) {
            verboseLog(chalk.blue(`Validated tsconfig file at ${argsTsConfig}`));
            return argsTsConfig;
        } else {
            console.log(chalk.red(`🚨 Invalid tsconfig file path provided! there is no tscconfig file at ${argsTsConfig}`));
        }
    } else if (!argsTsConfig) {
        verboseLog(chalk.blue('🔍 No tsconfig path provided. Checking default tsconfig paths...'));
        const tsConfigPaths = [
            path.join(process.cwd(), 'tsconfig.json'),
            path.join(process.cwd(), 'tsconfig.base.json'),
        ]
        const tsConfigPath = tsConfigPaths.find((tsConfigPath) => {
            const exists = fs.existsSync(tsConfigPath);
            verboseLog(chalk.blue(`Checking if tsconfig file exists at ${tsConfigPath}... ${exists ? '✅' : '❌'}`));
            return exists;
        });
        if (tsConfigPath) {
            console.log(chalk.blue(`🔍 Found tsconfig file at ${tsConfigPath}`));
            return tsConfigPath;
        }

        verboseLog(chalk.red(`🚨 No tsconfig file found in the current directory!`));
        console.log(chalk.red(`🚨 A valid tsconfig path is required!`));
    };

}

// Check if the given target is a valid glob pattern
export function getGivenOrDefaultFileGlob(globPattern, argName) {
    if (globPattern) {
        if (glob.hasMagic(globPattern)) {
            return globPattern;
        } else {
            console.log(chalk.red(`🚨 Invalid glob pattern provided for ${argName}! default: **/*.{ts,tsx,js,jsx}`));
        }
    }
}

export const readTsConfig = (tsconfigPath) => {
    console.log(chalk.blue(`📖 Reading tsconfig file from ${tsconfigPath}...`));
    if(!jsoncParser) console.log(chalk.red(`🚨 jsonc-parser is not installed!`));
    return jsoncParser.parse(fs.readFileSync(tsconfigPath, 'utf8'));
};

// Prepare TypeScript paths
export const preparePaths = (tsconfig, excludedPaths) => {
    const paths = Object.entries(tsconfig.compilerOptions.paths)
        .filter(([alias]) => !excludedPaths.some(excludedPath => {
            const shouldSkipAlias = alias.includes(excludedPath);
            shouldSkipAlias && console.log(`⏩ Skipping TypeScript alias: ${chalk.yellow(alias)} because it contains excluded path: ${chalk.yellow(excludedPath)}`);

            return shouldSkipAlias;
        }))
        .map(([alias, paths]) => ({
            aliasRegex: new RegExp('^' + alias.replace(/\*/g, '.*') + '$'),
            alias: alias.replace('/*', ''),
            path: paths[0].replace('/*', '')
        }))
        .sort((a, b) => b.alias.length - a.alias.length);

    console.log(`\r\n🔍 Found TypeScript aliases: \r\n${chalk.yellow(paths.map(({ alias }) => `- ${alias}`).join('\r\n'))} \r\n`);
    return paths;
};

// Find TS paths' matches in a file
export const findMatches = (targetFilePath, paths) => {
    verboseLog(chalk.gray(`Reading target file from ${chalk.green(targetFilePath)}`));
    const targetFileContent = fs.readFileSync(targetFilePath, 'utf8');
    const importRegex = /import\s+[\w{},*\s]+\s+from\s+['"]([^'"]+)['"];/g;
    const matches = [];
    targetFileContent.replace(importRegex, function (match, importPath) {
        for (const { alias, aliasRegex, path } of paths) {
            if (aliasRegex.test(importPath)) {
                matches.push({ match, alias, importPath, aliasPath: path });
                return match;
            }
        }
    });
    matches.length > 0 ? verboseLog(chalk.yellow(`Found ${chalk.yellow(matches.length)} import statements in ${chalk.green(targetFilePath)}`)) : verboseLog(chalk.gray(`No import statements found in ${chalk.green(targetFilePath)} that uses TypeScript aliases`));
    return { matches, targetFileContent };
};

// Replace aliases with relative paths
export const replaceAliases = (matches, targetFileContent, targetFilePath) => {
    let result = targetFileContent;
    matches.length && console.log(`\r\n🔍 Found ${chalk.yellow(matches.length)} alias import statements in ${chalk.green(targetFilePath)}`);
    matches.forEach(({ match, alias, aliasPath, importPath }) => {
        const relativePathToAliasPath = importPath.replace(alias, '')
        const relativePath = path.relative(path.dirname(targetFilePath), aliasPath);
        const longestRelativeImportPath = path.join(relativePath, relativePathToAliasPath);
        const fixedRelativeImportPath = match.replace(importPath, longestRelativeImportPath);
        result = result.replace(match, fixedRelativeImportPath);
        console.log(chalk.green(`📝 Replaced alias ${chalk.yellow(alias)} with relative path ${chalk.yellow(longestRelativeImportPath)} \r\n- Original import statement:\r\n${chalk.blue(match)} \r\n- Replaced import statement:  \r\n${chalk.blue(fixedRelativeImportPath)}`));
    });
    return result;
};

export const writeResultToFile = (targetFilePath, result) => {
    if (cliOptions.dry) return;
    !cliOptions.dry && console.log(chalk.blue('Writing result back to target file...'));
    !cliOptions.dry && fs.writeFileSync(targetFilePath, result, 'utf8');
    console.log(chalk.green('Done.'));
};

export const main = () => {
    cliOptions = init();
    const { targetGlob, excludeGlob } = cliOptions;
    const tsconfig = readTsConfig(clitsconfigPath);
    const paths = preparePaths(tsconfig, excludedPaths);

    console.log(chalk.yellow(`🔍 Searching for files matching the glob pattern: ${chalk.green(targetGlob)}`));

    glob(targetGlob, { ignore: excludeGlob }, (err, files) => {
        if (err) throw err;

        console.log(chalk.yellow(`🚀 Found ${files.length} files to process:`));

        const fileCounts = {};

        files.forEach(file => {
            const extension = path.extname(file).slice(1);
            if (fileCounts.hasOwnProperty(extension)) {
                fileCounts[extension]++;
            } else {
                fileCounts[extension] = 1;
            }
        });

        Object.entries(fileCounts).forEach(([extension, count]) => {
            if (count > 0) {
                console.log(chalk.yellow(`  - ${count} ${extension.toUpperCase()} files`));
            }
        });

        if (cliOptions.dry) {
            return replaceImports({ files, paths });
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log(chalk.red('\r\n🚨 WARNING: This operation will overwrite the files!'), chalk.green(`You can also try to run with ${chalk.bold('-dry')} flag to preview changes without modifying files`));
        rl.question('Files will be overwritten, do you want to continue? (y/n) ', (answer) => {
            if (answer.toLowerCase() === 'y') {
                console.log('User chose to continue. Replacing imports...');
                replaceImports({ files, paths });
            } else {
                console.log('Operation cancelled by user.');
            }
            console.log('Closing readline interface...');
            rl.close();
        });
    });
};

export function replaceImports({ files, paths }) {
    console.log(chalk.yellow('🔧 Proceeding with replacing alias imports to relative paths...'));

    let fixedImportStatements = 0;
    files.forEach(file => {
        const { matches, targetFileContent } = findMatches(file, paths);
        if (matches.length === 0) return;
        const result = replaceAliases(matches, targetFileContent, file);
        fixedImportStatements += matches.length;
        writeResultToFile(file, result);
    });

    cliOptions.dry && console.log(chalk.blue('\r\nDry-run mode enabled. No files were written.'));

    console.log(chalk.green(`\r\n🎉 All done! I have fixed ${chalk.yellow(fixedImportStatements)} imports by checking ${chalk.yellow(files.length)} files!`));
    console.log(chalk.green(`🚀 Happy coding! If I saved your time/energy/happiness, consider supporting me 😊`));
    console.log(chalk.green(`💖 You can show your support by giving a star to my GitHub repository:`));
    console.log(chalk.green(`🌟 Halil Emre Özen - https://github.com/halilemreozen`));
    console.log(chalk.green(`🙏 Thank you for using me! Let's make the world of coding better together!`));
}
