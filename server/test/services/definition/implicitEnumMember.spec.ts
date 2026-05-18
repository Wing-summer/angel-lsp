import {testDefinition} from './utils';

describe('definition/implicitEnumMember', () => {
    it('resolves implicit enum member access without scope qualifier', () => {
        testDefinition(`
            enum Dummy0 { Red }
            
            enum Color { Red$C0$ }
            
            enum Dummy1 { Red }

            void f() {
                Color r1 = Color::Red$C1$;
                Color r2 = Red$C2$;
            }
        `);
    });

    it('resolves an implicit enum member to the Animal enum based on return and parameter type context', () => {
        testDefinition(`
            enum Animal {
                Bat$C0$
            }

            enum File {
                Bat
            }

            Animal get() {
                return Bat$C1$;
            }

            void accept(Animal f){
            }

            void f() {
                accept(Bat$C2$);
            }
        `);
    });

    it('resolves an implicit enum member to the File enum based on return and parameter type context', () => {
        testDefinition(`
            enum Animal {
                Bat
            }

            enum File {
                Bat$C0$
            }

            File get() {
                return Bat$C1$;
            }

            void accept(File f){
            }

            void f() {
                accept(Bat$C2$);
            }
        `);
    });
});
