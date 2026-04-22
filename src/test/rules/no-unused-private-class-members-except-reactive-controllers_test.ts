/**
 * @fileoverview Tests for no-unused-private-class-members-except-reactive-controllers
 */

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

import {rule} from '../../rules/no-unused-private-class-members-except-reactive-controllers.js';
import {RuleTester} from 'eslint';

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022
  }
});

ruleTester.run(
  'no-unused-private-class-members-except-reactive-controllers',
  rule,
  {
    valid: [
      // No private members
      'class Foo {}',

      // Private field that is read
      `class Foo {
        #x = 5;
        getX() { return this.#x; }
      }`,

      // Private method that is called
      `class Foo {
        #doSomething() {}
        method() { this.#doSomething(); }
      }`,

      // Private getter — accessors are always considered used
      `class Foo {
        get #value() { return 5; }
        method() { return this.#value; }
      }`,

      // -----------------------------------------------------------------------
      // Imported / unresolved controller classes: trust new X(this) heuristic
      // -----------------------------------------------------------------------

      // Imported controller: not locally defined, trust new X(this) heuristic
      `class FieldButton extends LitElement {
        #events = new EventsController(this);
      }`,

      // ReactiveController with additional constructor arguments
      `class Foo extends LitElement {
        #mouse = new MouseController(this, { threshold: 5 });
      }`,

      // Multiple imported ReactiveControllers
      `class Foo extends LitElement {
        #events = new EventsController(this);
        #mouse = new MouseController(this);
      }`,

      // ReactiveController in a non-LitElement class (any host works)
      `class Foo {
        #ctrl = new SomeController(this);
      }`,

      // -----------------------------------------------------------------------
      // Locally-defined controller classes: verified via RC method presence
      // -----------------------------------------------------------------------

      // Local class with hostConnected
      `class LocalController {
        hostConnected() {}
      }
      class Foo extends LitElement {
        #ctrl = new LocalController(this);
      }`,

      // Local class with hostDisconnected
      `class LocalController {
        hostDisconnected() {}
      }
      class Foo extends LitElement {
        #ctrl = new LocalController(this);
      }`,

      // Local class with hostUpdate
      `class LocalController {
        hostUpdate() {}
      }
      class Foo extends LitElement {
        #ctrl = new LocalController(this);
      }`,

      // Local class with hostUpdated
      `class LocalController {
        hostUpdated() {}
      }
      class Foo extends LitElement {
        #ctrl = new LocalController(this);
      }`,

      // Local class with multiple RC methods
      `class LocalController {
        hostConnected() {}
        hostDisconnected() {}
      }
      class Foo extends LitElement {
        #ctrl = new LocalController(this);
      }`,

      // -----------------------------------------------------------------------
      // Mixed cases
      // -----------------------------------------------------------------------

      // One verified local controller + one used regular field
      `class EventsController {
        hostConnected() {}
      }
      class Foo extends LitElement {
        #events = new EventsController(this);
        #count = 0;
        increment() { this.#count++; return this.#count; }
      }`,

      // Private field written and read via compound assignment
      `class Foo {
        #x = 0;
        method() { this.#x += 1; return this.#x; }
      }`
    ],

    invalid: [
      // Unused private field
      {
        code: `class Foo {
          #x = 5;
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#x'}
          }
        ]
      },

      // Unused private method
      {
        code: `class Foo {
          #doSomething() {}
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#doSomething'}
          }
        ]
      },

      // Unused private field in a LitElement class (not a controller)
      {
        code: `class Foo extends LitElement {
          #x = 5;
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#x'}
          }
        ]
      },

      // new expression without this — not a ReactiveController
      {
        code: `class Foo extends LitElement {
          #ctrl = new SomeClass();
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#ctrl'}
          }
        ]
      },

      // new expression passing something other than this — not a ReactiveController
      {
        code: `class Foo extends LitElement {
          #ctrl = new SomeClass(otherHost);
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#ctrl'}
          }
        ]
      },

      // Write-only field (only assigned, never read)
      {
        code: `class Foo {
          #x = 0;
          method() { this.#x = 1; }
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#x'}
          }
        ]
      },

      // Multiple unused private members
      {
        code: `class Foo {
          #x = 0;
          #doSomething() {}
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#x'}
          },
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#doSomething'}
          }
        ]
      },

      // -----------------------------------------------------------------------
      // Local class verification: not a ReactiveController → should report
      // -----------------------------------------------------------------------

      // Local class with no RC methods
      {
        code: `class NotAController {
          doSomething() {}
        }
        class Foo extends LitElement {
          #ctrl = new NotAController(this);
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#ctrl'}
          }
        ]
      },

      // Local class with only static RC methods — static methods don't count
      {
        code: `class NotAController {
          static hostConnected() {}
        }
        class Foo extends LitElement {
          #ctrl = new NotAController(this);
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#ctrl'}
          }
        ]
      },

      // Local empty class
      {
        code: `class EmptyClass {}
        class Foo extends LitElement {
          #ctrl = new EmptyClass(this);
        }`,
        errors: [
          {
            messageId: 'unusedPrivateClassMember',
            data: {classMemberName: '#ctrl'}
          }
        ]
      }
    ]
  }
);
