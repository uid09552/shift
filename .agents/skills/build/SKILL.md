---
name: build
description: Build the project by running `make build` in both the `ui` and `main` directories. Use for build validation, testing compilation, and generating build artifacts.
---

# Build

Run the build process in both project components:

```bash
(cd ui && make build) && (cd main && make build)
````

Or individually:

```bash
cd ui && make build
cd ../main && make build
```

Report any build failures and include relevant error output.

