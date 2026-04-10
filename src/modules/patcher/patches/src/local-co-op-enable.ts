import { BxLogger as OrgBxLogger } from "@/utils/bx-logger";

declare const BxLogger: typeof OrgBxLogger;
declare const $this$: any;

// Save the original onGamepadChanged() and onGamepadInput()
$this$.orgOnGamepadChanged = $this$.onGamepadChanged;
$this$.orgOnGamepadInput = $this$.onGamepadInput;

let match;
let onGamepadChangedStr = $this$.onGamepadChanged.toString();

// Fix problem with Safari
if (onGamepadChangedStr.startsWith('function ')) {
    onGamepadChangedStr = onGamepadChangedStr.substring(9);
}

// Log the original function for debugging
BxLogger.info('supportLocalCoOp', 'onGamepadChanged length:', onGamepadChangedStr.length);

// Replace hardcoded gamepad index 0 with the actual index from arguments[1].
// Use targeted regex patterns to avoid corrupting unrelated values like
// !0 (boolean true), button values, or multi-digit numbers.
const originalChangedStr = onGamepadChangedStr;
onGamepadChangedStr = onGamepadChangedStr
    // GamepadIndex:0 → GamepadIndex:arguments[1]
    .replace(/GamepadIndex\s*:\s*0(?=[,}\]\);\s])/g, 'GamepadIndex:arguments[1]')
    // Map operations: .set(0, .get(0) .delete(0) .has(0)
    .replace(/(\.(?:set|get|delete|has)\s*\()0(?=[,)])/g, '$1arguments[1]')
    // Strict equality/inequality: ===0 or !==0
    .replace(/(={2,3})0(?=[,)}\];])/g, '$1arguments[1]')
    // Array bracket access: [0]
    .replace(/\[0\]/g, '[arguments[1]]')
    // Function call with 0 as first arg: fn(0, or fn(0)
    .replace(/(\()0(?=[,)])/g, '$1arguments[1]')
    // 0 as middle/last arg: ,0, or ,0)
    .replace(/(,)0(?=[,)])/g, '$1arguments[1]');

if (onGamepadChangedStr === originalChangedStr) {
    // Targeted patterns didn't match anything - fall back to original replaceAll
    BxLogger.warning('supportLocalCoOp', 'Targeted regex did not match, using replaceAll fallback');
    onGamepadChangedStr = originalChangedStr.replaceAll('0', 'arguments[1]');
}

eval(`$this$.patchedOnGamepadChanged = function ${onGamepadChangedStr}`);
BxLogger.info('supportLocalCoOp', '✅ Patched onGamepadChanged');

let onGamepadInputStr = $this$.onGamepadInput.toString();
// Fix problem with Safari
if (onGamepadInputStr.startsWith('function ')) {
    onGamepadInputStr = onGamepadInputStr.substring(9);
}

BxLogger.info('supportLocalCoOp', 'onGamepadInput length:', onGamepadInputStr.length);

// Find the GamepadIndex variable reference in the minified code
match = onGamepadInputStr.match(/(\w+\.GamepadIndex)/);
if (!match) {
    match = onGamepadInputStr.match(/(\w+\["GamepadIndex"\])/);
}
if (!match) {
    match = onGamepadInputStr.match(/(\w+\?\.GamepadIndex)/);
}

if (match) {
    const gamepadIndexVar = match[0];
    BxLogger.info('supportLocalCoOp', 'Found GamepadIndex var:', gamepadIndexVar);
    let replaced = false;

    // Try to patch gamepadStates.get() to use the actual GamepadIndex
    if (onGamepadInputStr.includes('$this$.gamepadStates.get(')) {
        onGamepadInputStr = onGamepadInputStr.replace('$this$.gamepadStates.get(', `$this$.gamepadStates.get(${gamepadIndexVar},`);
        replaced = true;
    }

    if (!replaced) {
        const statesGetMatch = onGamepadInputStr.match(/(\w+)\.gamepadStates\.get\(/);
        if (statesGetMatch) {
            onGamepadInputStr = onGamepadInputStr.replace(
                statesGetMatch[0],
                `${statesGetMatch[1]}.gamepadStates.get(${gamepadIndexVar},`,
            );
            replaced = true;
        }
    }

    if (replaced) {
        eval(`$this$.patchedOnGamepadInput = function ${onGamepadInputStr}`);
        BxLogger.info('supportLocalCoOp', '✅ Patched onGamepadInput');
    } else {
        BxLogger.error('supportLocalCoOp', '❌ gamepadStates.get pattern not found');
    }
} else {
    BxLogger.error('supportLocalCoOp', '❌ GamepadIndex not found in onGamepadInput');
}

// Add method to switch between patched and original methods
$this$.toggleLocalCoOp = (enable: boolean) => {
    BxLogger.info('toggleLocalCoOp', enable ? 'Enabled' : 'Disabled');
    window.BX_EXPOSED.localCoOpEnabled = enable;

    $this$.onGamepadChanged = enable ? $this$.patchedOnGamepadChanged : $this$.orgOnGamepadChanged;
    $this$.onGamepadInput = enable ? $this$.patchedOnGamepadInput : $this$.orgOnGamepadInput;

    // Reconnect all gamepads
    const gamepads = window.navigator.getGamepads();
    for (const gamepad of gamepads) {
        if (!gamepad?.connected) {
            continue;
        }

        // Ignore virtual controller
        if (gamepad.id.includes('Better xCloud')) {
            continue;
        }

        // Don't show toast
        (gamepad as any)._noToast = true;

        window.dispatchEvent(new GamepadEvent('gamepaddisconnected', { gamepad }));
        window.dispatchEvent(new GamepadEvent('gamepadconnected', { gamepad }));
    }
};

// Expose this method
window.BX_EXPOSED.toggleLocalCoOp = $this$.toggleLocalCoOp.bind(this);
