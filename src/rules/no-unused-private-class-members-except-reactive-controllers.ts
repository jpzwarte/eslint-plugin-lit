/**
 * @fileoverview Rule to flag unused private class members, with an exemption
 * for Lit ReactiveController instances (new Controller(this))
 * @author Jeroen Zwartepoorte
 */

import {Rule} from 'eslint';
import * as ESTree from 'estree';

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

type RuleNode = ESTree.Node & Rule.NodeParentExtension;

interface MemberInfo {
  declaredNode: ESTree.PropertyDefinition | ESTree.MethodDefinition;
  isAccessor: boolean;
  isUsed: boolean;
  isReactiveController: boolean;
}

// The four instance methods defined by the ReactiveController interface in Lit
const REACTIVE_CONTROLLER_METHODS = new Set([
  'hostConnected',
  'hostDisconnected',
  'hostUpdate',
  'hostUpdated'
]);

/**
 * Returns true if the class body contains at least one instance method that is
 * part of the ReactiveController interface.
 */
function hasReactiveControllerMethods(classBody: ESTree.ClassBody): boolean {
  return classBody.body.some((member) => {
    if (member.type !== 'MethodDefinition' || member.static) {
      return false;
    }
    const key = member.key;
    return key.type === 'Identifier' && REACTIVE_CONTROLLER_METHODS.has(key.name);
  });
}

/**
 * Returns true if the private identifier is only written to (never read).
 * Mirrors the same logic from the built-in no-unused-private-class-members rule.
 */
function isWriteOnlyAssignment(
  node: ESTree.PrivateIdentifier & Rule.NodeParentExtension
): boolean {
  const memberExpr = node.parent as RuleNode;
  const parentStmt = memberExpr.parent as RuleNode;
  const isAssignment = parentStmt.type === 'AssignmentExpression';

  if (
    !isAssignment &&
    parentStmt.type !== 'ForInStatement' &&
    parentStmt.type !== 'ForOfStatement' &&
    parentStmt.type !== 'AssignmentPattern'
  ) {
    return false;
  }

  // If it's not on the left-hand side, it's a read
  const stmtWithLeft = parentStmt as ESTree.Node & {left: ESTree.Node};
  if (stmtWithLeft.left !== memberExpr) {
    return false;
  }

  // Compound assignment (+=, -=, etc.) still reads the value, unless the
  // result is immediately discarded in an expression statement
  if (isAssignment && (parentStmt as ESTree.AssignmentExpression).operator !== '=') {
    return parentStmt.parent.type === 'ExpressionStatement';
  }

  return true;
}

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

export const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow unused private class members, except for ReactiveController instances',
      recommended: false,
      url: 'https://github.com/43081j/eslint-plugin-lit/blob/master/docs/rules/no-unused-private-class-members-except-reactive-controllers.md'
    },
    schema: [],
    messages: {
      unusedPrivateClassMember: "'{{classMemberName}}' is defined but never used."
    }
  },

  create(context): Rule.RuleListener {
    const trackedClasses: Array<Map<string, MemberInfo>> = [];

    // Maps locally-defined class names to whether they implement ReactiveController.
    // Built up as ClassDeclaration/ClassExpression nodes are visited.
    const localClasses = new Map<string, boolean>();

    /**
     * Returns true when the field initializer is `new X(this, ...)` and X is
     * either a locally-verified ReactiveController or an imported/unknown class
     * (where we trust the conventional host-passing pattern).
     */
    function isReactiveControllerInit(
      value: ESTree.Expression | null | undefined
    ): boolean {
      if (!value || value.type !== 'NewExpression') {
        return false;
      }

      // Must pass `this` as an argument — the standard ReactiveController host pattern
      if (!value.arguments.some((arg) => arg.type === 'ThisExpression')) {
        return false;
      }

      // If the class is defined locally, require it to actually implement the interface
      if (value.callee.type === 'Identifier') {
        const className = value.callee.name;
        if (localClasses.has(className)) {
          return localClasses.get(className) === true;
        }
      }

      // For imported or otherwise unresolvable classes, trust the new X(this) pattern
      return true;
    }

    return {
      // Track every locally-defined class so we can verify RC method presence.
      // ClassDeclaration fires before ClassBody of that same class, but the full
      // AST is already built, so node.body.body is accessible immediately.
      ClassDeclaration(node): void {
        if (node.id) {
          localClasses.set(node.id.name, hasReactiveControllerMethods(node.body));
        }
      },

      ClassExpression(node): void {
        if (node.id) {
          localClasses.set(node.id.name, hasReactiveControllerMethods(node.body));
        }
      },

      ClassBody(classBodyNode): void {
        const privateMembers = new Map<string, MemberInfo>();
        trackedClasses.unshift(privateMembers);

        for (const bodyMember of classBodyNode.body) {
          if (
            bodyMember.type === 'PropertyDefinition' ||
            bodyMember.type === 'MethodDefinition'
          ) {
            if (bodyMember.key.type === 'PrivateIdentifier') {
              const isController =
                bodyMember.type === 'PropertyDefinition'
                  ? isReactiveControllerInit(bodyMember.value)
                  : false;

              privateMembers.set(bodyMember.key.name, {
                declaredNode: bodyMember,
                isAccessor:
                  bodyMember.type === 'MethodDefinition' &&
                  (bodyMember.kind === 'set' || bodyMember.kind === 'get'),
                isUsed: false,
                isReactiveController: isController
              });
            }
          }
        }
      },

      PrivateIdentifier(node): void {
        const classBody = trackedClasses.find((classProperties) =>
          classProperties.has(node.name)
        );

        if (!classBody) {
          return;
        }

        const memberDef = classBody.get(node.name)!;

        if (memberDef.isUsed) {
          return;
        }

        // Skip the declaration site itself
        if (
          node.parent.type === 'PropertyDefinition' ||
          node.parent.type === 'MethodDefinition'
        ) {
          return;
        }

        // Any access to an accessor (get/set) counts as used due to possible side effects
        if (memberDef.isAccessor) {
          memberDef.isUsed = true;
          return;
        }

        if (isWriteOnlyAssignment(node)) {
          return;
        }

        const memberExpr = node.parent as RuleNode;
        const wrappingExpr = memberExpr.parent as RuleNode;
        const parentOfWrapping = wrappingExpr.parent as RuleNode;

        // `this.#x++;` — only increments, result is discarded
        if (
          wrappingExpr.type === 'UpdateExpression' &&
          parentOfWrapping.type === 'ExpressionStatement'
        ) {
          return;
        }

        // `({ x: this.#x } = bar)` — destructuring write target
        if (
          wrappingExpr.type === 'Property' &&
          parentOfWrapping.type === 'ObjectPattern' &&
          (wrappingExpr as ESTree.Property).value === (memberExpr as ESTree.Node)
        ) {
          return;
        }

        // `[...this.#x] = bar` — rest element write
        if (wrappingExpr.type === 'RestElement') {
          return;
        }

        // `[this.#x] = bar` — array pattern write
        if (wrappingExpr.type === 'ArrayPattern') {
          return;
        }

        memberDef.isUsed = true;
      },

      'ClassBody:exit'(): void {
        const unusedPrivateMembers = trackedClasses.shift()!;

        for (const [
          classMemberName,
          {declaredNode, isUsed, isReactiveController}
        ] of unusedPrivateMembers.entries()) {
          if (isUsed || isReactiveController) {
            continue;
          }
          context.report({
            node: declaredNode,
            messageId: 'unusedPrivateClassMember',
            data: {
              classMemberName: `#${classMemberName}`
            }
          });
        }
      }
    };
  }
};
