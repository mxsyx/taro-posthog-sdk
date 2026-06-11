module.exports = {
    ignorePatterns: ['src/version.ts', 'dist/**/*', 'node_modules/**/*', 'coverage/**/*'],
    rules: {
        'no-console': 'off',
        '@typescript-eslint/naming-convention': 'off',
        'posthog-js/no-direct-undefined-check': 'off',
        'posthog-js/no-direct-boolean-check': 'off',
        'posthog-js/no-direct-null-check': 'off',
        'posthog-js/no-direct-function-check': 'off',
        'posthog-js/no-direct-number-check': 'off',
        'posthog-js/no-direct-date-check': 'off',
        'posthog-js/no-direct-array-check': 'off',
        'posthog-js/no-add-event-listener': 'off',
        'compat/compat': 'off',
    },
}
