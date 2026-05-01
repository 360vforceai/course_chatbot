/**
 * Compatibility wrapper.
 *
 * The original repo used registerCommands.js, while package.json now uses
 * register-commands.js. Keeping this wrapper prevents older instructions or
 * scripts from breaking.
 */
require('./register-commands');
