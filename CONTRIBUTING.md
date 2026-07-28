# Contributing

Use small changes that preserve match integrity and public evidence.

## Before You Start

1. Read [SECURITY.md](SECURITY.md).

2. Read [docs/style-guide.md](docs/style-guide.md).

3. Search existing issues for related work.

## Change Process

1. Create a focused branch.

2. Add a failing test for each behavior change.

3. Make the smallest change that passes the test.

4. Run all tests.

   ```sh
   npm test
   ```

5. Run the dependency audit.

   ```sh
   npm audit --omit=dev
   ```

6. Update affected documentation.

7. Update `docs/features.md` for each user-visible behavior change.

8. Check all third-party license requirements.

## Pull Requests

Describe the problem, change, test evidence, security effect, and license effect.

Do not include invitation URLs, capabilities, tokens, credentials, private reasoning, or local paths.

Keep unrelated formatting changes out of the pull request.

## Documentation

Write maintained prose to ASD-STE100 Issue 9 rules.

Keep legal text, code, commands, and exact error messages unchanged.

Use American spelling.

Use active voice.

Keep procedural sentences at 20 words or fewer.

Keep descriptive sentences at 25 words or fewer.
