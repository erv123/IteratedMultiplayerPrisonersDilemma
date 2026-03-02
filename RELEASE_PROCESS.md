Release process (GitHub Actions) — deployable to TrueNAS SCALE
=============================================================

This document describes a recommended GitHub Actions-based release process that produces
artifacts suitable for deployment to TrueNAS SCALE. The steps below create a reproducible
build, package a Docker image (and an optional image tarball), publish a GitHub Release,
and provide two deployment options for TrueNAS SCALE: pulling the image from a registry
or importing an image tarball to the host.

Overview (high level)
- Create a workflow triggered on a release or git tag
- Install dependencies, run tests, build frontend assets
- Build a Docker image and push to a container registry (Docker Hub, GHCR, private registry)
- Produce release artifacts: a docker image tarball (docker save), a zip/tar of compiled app, and an optional Helm chart or k8s manifest
- Create a GitHub Release and upload artifacts

Secrets required in the repository (GitHub Settings → Secrets):
- DOCKER_REGISTRY      (e.g. ghcr.io or docker.io)
- DOCKER_USERNAME
- DOCKER_PASSWORD
- DOCKER_IMAGE         (e.g. ghcr.io/yourorg/iterated-prisoners-dilemma)
- OPTIONAL: HELM_REPO_CREDS if publishing charts to a Helm repo

Recommended workflow (example)
--------------------------------
Create a workflow file (example: `.github/workflows/release.yml`) with the following steps. This example builds the Node app, runs tests, builds and pushes a Docker image, saves the image as a tar artifact, and creates a GitHub Release.

Example minimal workflow (trimmed and annotated):

```yaml
name: Release
on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Use Node
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build frontend
        run: npm run build

      - name: Set up QEMU (for multi-arch, optional)
        uses: docker/setup-qemu-action@v2

      - name: Login to registry
        uses: docker/login-action@v2
        with:
          registry: ${{ secrets.DOCKER_REGISTRY }}
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v4
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: |
            ${{ secrets.DOCKER_IMAGE }}:${{ github.ref_name }}
            ${{ secrets.DOCKER_IMAGE }}:latest

      - name: Save image tarball (artifact)
        run: |
          IMAGE=${{ secrets.DOCKER_IMAGE }}:${{ github.ref_name }}
          docker pull "$IMAGE"
          docker save "$IMAGE" | gzip > artifact-image-${{ github.ref_name }}.tar.gz

      - name: Create GitHub release
        id: create_release
        uses: ncipollo/release-action@v1
        with:
          tag: ${{ github.ref_name }}
          name: Release ${{ github.ref_name }}

      - name: Upload image artifact
        uses: actions/upload-artifact@v4
        with:
          name: docker-image-${{ github.ref_name }}
          path: artifact-image-${{ github.ref_name }}.tar.gz

      - name: Upload additional compiled artifact (zip)
        run: |
          tar -czf app-${{ github.ref_name }}.tar.gz ./build
        - uses: actions/upload-artifact@v4
          with:
            name: app-build-${{ github.ref_name }}
            path: app-${{ github.ref_name }}.tar.gz
```

Notes about this workflow
- The workflow triggers on annotated git tags that look like `v1.2.3`.
- Use `docker/build-push-action` for reliable builds and pushing to registries.
- We produce a gzip-compressed `docker save` tarball artifact so administrators can import the image into TrueNAS SCALE without a registry.

TrueNAS SCALE deployment options
--------------------------------
Option A — Recommended: Pull from a registry

1. Publish the Docker image to a registry (as the workflow does).
2. On TrueNAS SCALE, go to Apps → Manage Catalogs / Install an app and configure a deployment that references the image tag you pushed.
3. If using a private registry, add registry credentials in TrueNAS SCALE (System Settings → Registries or provide credentials when creating the App).

This method is the cleanest for production and allows easy updates by changing the image tag.

Option B — Import the image tarball produced by the workflow (no registry)

1. From the GitHub Actions release, download the `artifact-image-<tag>.tar.gz` file.
2. Copy the tarball to the TrueNAS SCALE host (use `scp` or the TrueNAS file upload UI).
3. On the TrueNAS SCALE host, import the image into the container runtime (containerd). Example using `ctr`/`nerdctl` (may require sudo):

```bash
# copy artifact to truenas: scp artifact-image-v1.2.3.tar.gz truenas:/tmp/
ssh truenas
sudo gzip -d /tmp/artifact-image-v1.2.3.tar.gz
sudo ctr -n k8s.io images import /tmp/artifact-image-v1.2.3.tar
# or if nerdctl is available:
sudo nerdctl load -i /tmp/artifact-image-v1.2.3.tar
```

4. Create an App/Helm release on TrueNAS SCALE that references the imported image tag (local images are available to the cluster once imported).

Deployment artifacts to include
- Docker image tarball (docker save | gzip)
- Compiled frontend asset tarball (build output)
- Optional: Helm chart or Kubernetes manifest that references the image tag and service/ingress configuration

Tips and best practices
- Sign your git tags (optional) and use protected branches to control releases.
- Keep secrets out of the repository; use GitHub Actions secrets and, if needed, a registry-specific robot account.
- If you need a private registry but don't want external hosting, consider running a registry container on TrueNAS SCALE and pushing images there from the workflow.
- Add a smoke-test step after deployment (optionally call a small health-check endpoint) to validate the deployed release.

Advanced: publish Helm chart automatically
- If you manage a Helm chart, add a step to package the chart (`helm package`) and push it to a chart repository or include the packaged chart as a release artifact. TrueNAS SCALE's Apps system can use Helm charts for installation.

Rollback strategy
- Keep previous image tags available so you can redeploy an earlier tag quickly.
- Consider keeping a small `deploy` workflow that accepts a tag and updates the running deployment (e.g., by patching an existing k8s deployment) for quick rollbacks.

That's it — with the above workflow and artifacts, you can produce release bundles suitable for both registry-based and offline TrueNAS SCALE deployments.
