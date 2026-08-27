# A Template Repository for Space Cubics

This repository serves as a template for Space Cubics. You can use it
when creating a new repository. You can add, remove, or modify the
settings to fit your project.

## Codespell

https://github.com/codespell-project/codespell

Codespell is a tool for fixing common misspellings in text files. You
can add project-specific words to `.codespell-ignore` so that
codespell will ignore them.

## gitlint

https://github.com/jorisroovers/gitlint

gitlint is a linter for git commit messages. In our configuration,
gitlint checks all commits in a given pull request.

Special care is taken for lines that start with common Signed-off-by
lines or HTTPS references. See `.gitlint` for more details.

## linelint

https://github.com/fernandrone/linelint

linelint is a linter that checks for a trailing newline at the end of
a file. In C, a source file without a final newline is not valid.
This may not suit every repository or programming language, so remove
it if you do not need it.

## Dependabot

https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-dependabot-version-updates

`.github/dependabot.yml` configures GitHub Dependabot. This template
only defines updates for GitHub Actions. If you use other ecosystems
such as Python, Node.js, Rust, or others, please customize it.

## .gitignore

`.gitignore` specifies intentionally untracked files that Git should
ignore. The contents of this file may vary from project to project,
but you probably already know what to put here.

## .editorconfig

`.editorconfig` defines basic coding style settings for the project.
Many editors, such as Emacs, Vim, and Visual Studio Code, support it.

## CODEOWNERS

https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners

This template includes a `CODEOWNERS` file as a starting point.

When you create a new repository from this template, review the copied
`CODEOWNERS` file and replace the example entries with the actual
maintainers for that repository.

After updating the file, remove any unused comments and example lines.
Keep the file as simple as possible so that it reflects the actual
ownership rules for the repository.

`CODEOWNERS` entries consist of a path pattern followed by one or more
owners. Owners can be GitHub usernames or Space Cubics teams.

Example:

```text
*                      @yashi
/src/                  @spacecubics/software
/fpga/                 @spacecubics/fpga
```

Notes:

- Owners must have write access to the repository.
- Teams must be visible in the organization and have write access to the repository.
- If you want multiple owners for the same pattern, put them on the same line.
