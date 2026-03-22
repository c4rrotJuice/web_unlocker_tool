export function createLogger(scope) {
    return {
        info(message, details = undefined) {
            if (details === undefined) {
                console.info(`[writior-extension:${scope}] ${message}`);
                return;
            }
            console.info(`[writior-extension:${scope}] ${message}`, details);
        },
        warn(message, details = undefined) {
            if (details === undefined) {
                console.warn(`[writior-extension:${scope}] ${message}`);
                return;
            }
            console.warn(`[writior-extension:${scope}] ${message}`, details);
        },
    };
}
