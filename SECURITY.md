# Security policy

Please **do not** open public issues for security problems.

Report privately via GitHub: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the affected version. You should get a response within a week.

Scope notes:

- The server holds an Audiobookshelf API key with the permissions of the user it was issued for. Issues that let a client exceed `ABS_LIBRARY_IDS`, use write tools while `ABS_ENABLE_WRITE_TOOLS` is off, or bypass `MCP_HTTP_AUTH_TOKEN` are in scope.
- Permission decisions made by Audiobookshelf itself should be reported to the [Audiobookshelf project](https://github.com/advplyr/audiobookshelf).
