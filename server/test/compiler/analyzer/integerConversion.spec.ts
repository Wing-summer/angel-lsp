import {expectError, expectSuccess} from './utils';

describe('analyzer/integerConversion', () => {
    it('accepts: unsigned 32-bit to signed 64-bit implicit conversions', () => {
        expectSuccess(`
            void main() {
                uint a = 123;
                int64 b = a;
            }
        `);
    });

    it('accepts: explicit functional cast of a variable should not warn', () => {
        expectSuccess(`
            void main() {
                uint a = 123;
                int64 b = int(a);
            }
        `);
    });

    it('accepts: return int literal from int64 function', () => {
        expectSuccess(`
            int64 foo() {
                return 0;
            }
        `);
    });

    it('rejects: out-of-range integer literal in functional cast', () => {
        expectError(`
            void main() {
                int a = int(555555555555555555);
            }
        `);
    });
});
