# Release Process

Use this process for source, container, and binary releases.

Use a GitHub Release for the `v0.1.0-alpha` public release.

## Prepare

1. Confirm a clean release diff.

2. Remove local artifacts, credentials, tokens, paths, and generated sessions.

3. Update user documentation.

4. Update dependency notices.

5. Confirm the project version.

6. Confirm that public text uses Agent Chess as the project name.

7. Remove generated design references from release documentation.

8. Capture retained UI screenshots from the current local build.

9. Review `CHANGELOG.md`.

10. Confirm that the `v0.1.0-alpha` entry describes only shipped behavior.

## Verify

1. Install locked dependencies.

   ```sh
   npm ci
   ```

2. Run tests.

   ```sh
   npm test
   ```

3. Run the production dependency audit.

   ```sh
   npm audit --omit=dev
   ```

4. Run repository secret scanning.

5. Verify canonical third-party license files.

6. Verify that the default branch requires pull requests and CI.

7. Run the release checks.

   ```sh
   npm run check:release
   ```

8. Record the successful CI run URL and commit SHA.

## Stockfish Distribution Gate

Stockfish uses GPL-3.0.

Any distributed image or binary package must preserve its license and corresponding source access.

Use this exact source revision:

```text
https://github.com/nmrugg/stockfish.js/tree/93c994592dcf3b4b21052ab925e9b534df9c0918
```

Use this source archive SHA-256:

```text
ef9b6e9bd66de9869dc4715979ada23c6ab4fa96648025823a0a865f300667b2
```

Place the source archive beside every distributed container or binary artifact.

Do not describe that distribution as MIT-only.

Read [LICENSES.md](../LICENSES.md) before release.

## Publish

1. Create a signed release tag.

2. Attach source and required license files.

3. Attach the Stockfish corresponding source archive when applicable.

4. Publish checksums for release artifacts.

5. Verify links from a clean environment.

## GitHub Release

1. Create the signed `v0.1.0-alpha` tag from the verified commit.

2. Create a GitHub Release from that tag.

3. Copy the reviewed `v0.1.0-alpha` changelog entry into the release notes.

4. Link the successful CI run in the release notes.

5. Attach checksums and required license files.

## GitHub Settings After Publication

Do not state that these settings are enabled until an administrator verifies them.

If the GitHub plan permits, enable these repository settings after publication:

1. Secret scanning.

2. Push protection.

3. Dependabot security updates.

Confirm the dependency graph and Dependabot alerts before Dependabot security updates.
