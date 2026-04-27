import {afterEach, describe, it} from 'mocha';
import {copyGlobalSettings, resetGlobalSettings} from '../../src/core/settings';
import {diagnostic} from '../../src/core/diagnostic';
import {preprocessAfterTokenize} from '../../src/compiler_parser/parserPreprocess';
import {tokenize} from '../../src/compiler_tokenizer/tokenizer';
import {inspectFileContents} from '../inspectorUtils';
import {equal, ok} from 'node:assert';
import {DiagnosticTag} from 'vscode-languageserver-types';
import {fileURLToPath} from 'node:url';

const uri = 'file:///path/to/file.as';

function getPreprocessedTokenTexts(content: string): string[] {
    const inspector = inspectFileContents([{uri, content}]);
    return inspector.getRecord(uri).preprocessedOutput.preprocessedTokens.map(token => token.text);
}

function getPreprocessorDiagnostics(content: string) {
    const inspector = inspectFileContents([{uri, content}]);
    return inspector.getRecord(uri).diagnosticsInParser;
}

function getIncludePathTokenTexts(content: string): string[] {
    const inspector = inspectFileContents([{uri, content}]);
    return inspector.getRecord(uri).preprocessedOutput.includePathTokens.map(token => token.text);

function preprocessContent(input: string, definedSymbols: string[] = [], targetUri: string = uri) {
    diagnostic.beginSession();
    const rawTokens = tokenize(targetUri, input);
    const output = preprocessAfterTokenize(rawTokens, definedSymbols);
    const diagnostics = diagnostic.endSession();

    return {
        tokenTexts: output.preprocessedTokens.map(token => token.text),
        diagnostics: diagnostics
    };
}

describe('compiler/preprocessor', () => {
    afterEach(() => {
        resetGlobalSettings(undefined);
    });

    it('uses configured preprocessor defined symbols', () => {
        const content = `
#if ENABLE_SYMBOL
int featureEnabled;
#endif

int alwaysEnabled;
`;
        const settings = copyGlobalSettings();
        settings.definedSymbols = ['ENABLE_SYMBOL'];
        resetGlobalSettings(settings);

        const tokenTexts = getPreprocessedTokenTexts(content);

        ok(tokenTexts.includes('featureEnabled'));
        ok(tokenTexts.includes('alwaysEnabled'));
    });

    it('omits inactive #if blocks without configured symbols', () => {
        const content = `
#if ENABLE_SYMBOL
int featureEnabled;
#endif

int alwaysEnabled;
`;
        resetGlobalSettings(undefined);

        const tokenTexts = getPreprocessedTokenTexts(content);

        ok(!tokenTexts.includes('featureEnabled'));
        ok(tokenTexts.includes('alwaysEnabled'));
    });

    it('uses the first active #elif branch', () => {
        const content = `
#if DISABLED_SYMBOL
int disabledBranch;
#elif ENABLE_SYMBOL
int elifBranch;
#else
int elseBranch;
#endif
`;
        const settings = copyGlobalSettings();
        settings.definedSymbols = ['ENABLE_SYMBOL'];
        resetGlobalSettings(settings);

        const tokenTexts = getPreprocessedTokenTexts(content);

        ok(!tokenTexts.includes('disabledBranch'));
        ok(tokenTexts.includes('elifBranch'));
        ok(!tokenTexts.includes('elseBranch'));
    });

    it('uses #else when no previous branch is active', () => {
        const content = `
#if DISABLED_SYMBOL
int disabledBranch;
#elif ALSO_DISABLED
int elifBranch;
#else
int elseBranch;
#endif
`;

        const tokenTexts = getPreprocessedTokenTexts(content);

        ok(!tokenTexts.includes('disabledBranch'));
        ok(!tokenTexts.includes('elifBranch'));
        ok(tokenTexts.includes('elseBranch'));
    });

    it('marks only the inactive #else branch unnecessary', () => {
        const content = `
#if 1
int ifBranch;
#else
int elseBranch;
#endif
`;

        const tokenTexts = getPreprocessedTokenTexts(content);
        const diagnostics = getPreprocessorDiagnostics(content).filter(diagnostic =>
            diagnostic.tags?.includes(DiagnosticTag.Unnecessary)
        );

        ok(tokenTexts.includes('ifBranch'));
        ok(!tokenTexts.includes('elseBranch'));
        equal(diagnostics.length, 1);
        equal(diagnostics[0].range.start.line, 4);
    });

    it('evaluates numeric #if conditions', () => {
        const content = `
#if 0
int zeroBranch;
#endif

#if 1
int oneBranch;
#endif
`;

        const tokenTexts = getPreprocessedTokenTexts(content);

        ok(!tokenTexts.includes('zeroBranch'));
        ok(tokenTexts.includes('oneBranch'));
    });

    it('omits includes from inactive #if blocks', () => {
        const content = `
#if 0
#include "disabled.as"
#endif

#if 1
#include "enabled.as"
#endif
`;

        const includePathTexts = getIncludePathTokenTexts(content);

        ok(!includePathTexts.includes('"disabled.as"'));
        ok(includePathTexts.includes('"enabled.as"'));
    });

    it('omits defines from inactive #if blocks', () => {
        const content = `
#if 0
#define DISABLED_SYMBOL
#endif

#if DISABLED_SYMBOL
int disabledBranch;
#else
int elseBranch;
#endif
`;

        const tokenTexts = getPreprocessedTokenTexts(content);

        ok(!tokenTexts.includes('disabledBranch'));
        ok(tokenTexts.includes('elseBranch'));
    });

    it('evaluates prefixed numeric #if conditions', () => {
        const content = `
#if 0x0
int hexZeroBranch;
#endif

#if 0x2356
int hexBranch;
#endif

#if 0b0
int binaryZeroBranch;
#endif

#if 0b0101
int binaryBranch;
#endif

#if 0o0
int octalZeroBranch;
#endif

#if 0o123
int octalBranch;
#endif

#if 0d0
int decimalZeroBranch;
#endif

#if 0d2356
int decimalBranch;
#endif
`;

        const tokenTexts = getPreprocessedTokenTexts(content);

        ok(!tokenTexts.includes('hexZeroBranch'));
        ok(tokenTexts.includes('hexBranch'));
        ok(!tokenTexts.includes('binaryZeroBranch'));
        ok(tokenTexts.includes('binaryBranch'));
        ok(!tokenTexts.includes('octalZeroBranch'));
        ok(tokenTexts.includes('octalBranch'));
        ok(!tokenTexts.includes('decimalZeroBranch'));
        ok(tokenTexts.includes('decimalBranch'));
    });

    it('handles #ifdef #ifndef #elif #else #endif chains like conditional compilation', () => {
        const result = preprocessContent(
            `
            #ifdef FEATURE_A
            int fromIfdef;
            #elif FEATURE_B
            int fromElif;
            #else
            int fromElse;
            #endif

            #ifndef FEATURE_B
            int fromIfndef;
            #endif

            #if FEATURE_A && !FEATURE_B
            int fromIfExpression;
            #endif
        `,
            ['FEATURE_A']
        );

        assert(result.tokenTexts.includes('fromIfdef'));
        assert(!result.tokenTexts.includes('fromElif'));
        assert(!result.tokenTexts.includes('fromElse'));
        assert(result.tokenTexts.includes('fromIfndef'));
        assert(result.tokenTexts.includes('fromIfExpression'));
        assert.strictEqual(result.diagnostics.length, 0);
    });

    it('accepts #pragma and ignores its payload for token output', () => {
        const result = preprocessContent(`
            #pragma once
            int value;
        `);

        assert(result.tokenTexts.includes('value'));
        assert.strictEqual(result.diagnostics.length, 0);
    });

    it('evaluates configured macro replacement values in #if expressions', () => {
        const result = preprocessContent(
            `
            #if FEATURE_LEVEL >= 2
            int numericValue;
            #endif

            #if BUILD_FLAVOR + "_tools" == "dev_tools"
            int stringValue;
            #endif
        `,
            ['FEATURE_LEVEL=3', 'BUILD_FLAVOR=\"dev\"']
        );

        assert(result.tokenTexts.includes('numericValue'));
        assert(result.tokenTexts.includes('stringValue'));
        assert.strictEqual(result.diagnostics.length, 0);
    });

    it('treats standalone valueless macros as #ifdef-like checks in #if/#elif', () => {
        const result = preprocessContent(
            `
            #if EMPTY_MACRO
            int shouldAppearFromIf;
            #endif

            #if 0
            int shouldNotAppearFromElifHead;
            #elif EMPTY_MACRO
            int shouldAppearFromElif;
            #endif

            #if EMPTY_MACRO + 1
            int shouldNotAppearFromInvalidExpression;
            #endif
        `,
            ['EMPTY_MACRO']
        );

        assert(result.tokenTexts.includes('shouldAppearFromIf'));
        assert(result.tokenTexts.includes('shouldAppearFromElif'));
        assert(!result.tokenTexts.includes('shouldNotAppearFromElifHead'));
        assert(!result.tokenTexts.includes('shouldNotAppearFromInvalidExpression'));
        assert(
            result.diagnostics.some(item =>
                item.message.includes('Valueless macro `EMPTY_MACRO` can only be used alone in #if/#elif; use #ifdef/#ifndef instead.')
            )
        );
    });

    it('rejects #define and #undef inside script files', () => {
        const result = preprocessContent(`
            #define FEATURE_A 1
            #undef FEATURE_B
        `);

        assert(result.diagnostics.some(item => item.message.includes('#define is not allowed in script files')));
        assert(result.diagnostics.some(item => item.message.includes('#undef is not allowed in script files')));
    });

    it('rejects string-valued #if expressions', () => {
        const bareStringResult = preprocessContent(`
            #if "test"
            int shouldNotAppear;
            #endif
        `);

        const macroStringResult = preprocessContent(`
            #if BUILD_FLAVOR
            int shouldAlsoNotAppear;
            #endif
        `, ['BUILD_FLAVOR=\"dev\"']);

        assert(!bareStringResult.tokenTexts.includes('shouldNotAppear'));
        assert(!macroStringResult.tokenTexts.includes('shouldAlsoNotAppear'));
        assert(
            bareStringResult.diagnostics.some(item =>
                item.message.includes('#if expression must evaluate to a numeric or boolean value, not a string.')
            )
        );
        assert(
            macroStringResult.diagnostics.some(item =>
                item.message.includes('#if expression must evaluate to a numeric or boolean value, not a string.')
            )
        );
    });

    it('evaluates shift operators including >>>', () => {
        const result = preprocessContent(
            `
            #if 8 >> 1
            int shiftRight;
            #endif

            #if 8 >>> 1
            int unsignedShiftRight;
            #endif
        `,
            []
        );

        assert(result.tokenTexts.includes('shiftRight'));
        assert(result.tokenTexts.includes('unsignedShiftRight'));
        assert.strictEqual(result.diagnostics.length, 0);
    });
        assert(
            result.diagnostics.some(item =>
                item.message.includes('#else does not accept trailing tokens.')
            )
        );
        assert(
            result.diagnostics.some(item =>
                item.message.includes('#endif does not accept trailing tokens.')
            )
        );
    });

    it('reports empty invalid and unknown preprocessor directives precisely', () => {
        const result = preprocessContent(`
            #
            # 123
            #unknown anything
        `);

        assert(
            result.diagnostics.some(item =>
                item.message.includes('Expected a preprocessor directive name after `#`.')
            )
        );
        assert(
            result.diagnostics.some(item =>
                item.message.includes('Expected an identifier as the preprocessor directive name.')
            )
        );
        assert(
            result.diagnostics.some(item =>
                item.message.includes('Unsupported preprocessor directive: #unknown')
            )
        );
    });

    it('evaluates builtin dynamic macros by use site', () => {
        const builtinUri = 'file:///path/to/preprocessor_builtin.as';
        const builtinPath = fileURLToPath(builtinUri);
        const result = preprocessContent(
            `#if __LINE__ == 1
            int fromLine;
            #endif

            #if __SECTION__ == "${builtinPath.replace(/\\/g, '\\\\')}"
            int fromSection;
            #endif

            #if __SECTION_BASE__ == "preprocessor_builtin.as"
            int fromSectionBase;
            #endif
        `,
            [],
            builtinUri
        );

        assert(result.tokenTexts.includes('fromLine'));
        assert(result.tokenTexts.includes('fromSection'));
        assert(result.tokenTexts.includes('fromSectionBase'));
        assert.strictEqual(result.diagnostics.length, 0);
    });

    it('reports missing #endif at end of file', () => {
        const result = preprocessContent(`
            #if 5 > 6
            int shouldBeSkipped;
        `);

        assert(!result.tokenTexts.includes('shouldBeSkipped'));
        assert(
            result.diagnostics.some(item =>
                item.message.includes('Missing `#endif` for conditional preprocessor block.')
            )
        );
    });

    it('evaluates shift operators including >>>', () => {
        const result = preprocessContent(
            `
            #if 8 >> 1
            int shiftRight;
            #endif

            #if 8 >>> 1
            int unsignedShiftRight;
            #endif
        `,
            []
        );

        assert(result.tokenTexts.includes('shiftRight'));
        assert(result.tokenTexts.includes('unsignedShiftRight'));
        assert.strictEqual(result.diagnostics.length, 0);
    });

    it('rejects mixed string and numeric comparisons', () => {
        const result = preprocessContent(`
            #if "123" > 5
            int shouldNotAppear;
            #endif
        `);

        assert(!result.tokenTexts.includes('shouldNotAppear'));
        assert(
            result.diagnostics.some(item =>
                item.message.includes('Cannot compare string and numeric values in preprocessor expressions.')
            )
        );
    });
});
