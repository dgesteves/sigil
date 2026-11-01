#!/bin/sh
# Downloads the manifest validator used by `npm run lint:k8s` into .tools/:
#   - kubeconform v0.8.0 (https://github.com/yannh/kubeconform, Apache-2.0)
#   - strict JSON schemas for Kubernetes v1.37.2 from yannh/kubernetes-json-schema (Apache-2.0),
#     pinned to a commit.
# Every file is checked against a sha256 before it is used. Does nothing if .tools/ is complete.
set -eu

KUBECONFORM_VERSION=v0.8.0
SCHEMA_COMMIT=e0c72a1bc5f409d1685c0e1323460c8a98cd7459
SCHEMA_DIR=v1.37.2-standalone-strict

case "$(uname -m)" in
  x86_64 | amd64)
    arch=amd64
    tarball_sha=9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883
    binary_sha=457722b36e98d7bdbc91525e594951ef5d7ea3a29da2d13b9b28a2fb8a5097b7
    ;;
  aarch64 | arm64)
    arch=arm64
    tarball_sha=1f53fc8e81258197a35e8603054162a5af1de8c5af13746c71ab680d9534ed87
    binary_sha=7e77b104b3ae696389f91971c60fd58c72f1f3dc218f139df67a1b070959c012
    ;;
  *)
    echo "unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

schemas() {
  cat <<'EOF'
fed751af12c2873a7db2b4cd1294c2959497fda8520f1fc8e5d21adf967ad72e configmap-v1.json
84c4990d07d34fb8f7b62f1fda442e8ba25da93dc77bb737c4a901e4d6ae8780 cronjob-batch-v1.json
410871aa51ca678b861fddf530925f1fc6c9f38766975cbae3bb113c339fcecc daemonset-apps-v1.json
0b64451c0b8c36ea06dfebf952718810ae24a07779fb0ed2a6b03f1cc8735a54 deployment-apps-v1.json
a4420b08f7247bdb492972c7aff5213ae60c29eb5cea09b871afb9a21c294660 horizontalpodautoscaler-autoscaling-v1.json
932a0ed880648021d4ed951b65d2818980d6ecbf39663daa81951c5b974a38a2 horizontalpodautoscaler-autoscaling-v2.json
4e0f63ad84c2bf22565e489d1f4b885ddaa9f6bf7cff1ddd562553760afe4d79 ingress-networking-v1.json
1dbe7c98d227ab2614d85d4e70c2d04872239bb91c4ed30abc2cfadccef40e4b job-batch-v1.json
de9bfabf9ea0bff36b71e5e686d3ecce5246b098061f39a70549f82f8f03acd7 limitrange-v1.json
324fae677b98d1a6d54340db0c334d053e8ffbafceb3f73326e41de2610d5843 namespace-v1.json
f6324cc464f62228b0418f438d167208e4f86c7e3677ba30f608e79a8b26ba79 networkpolicy-networking-v1.json
71ef77ba30d96ec6d07bcfd8af9884ab83f4d877484579cad7f517804216bc1c persistentvolumeclaim-v1.json
e7629f45cce4493f02b9b5d97638a5b832fb5f28cdc978a5d786ab5b2981f617 pod-v1.json
0f7e20f2683a2c5a1b890a14f8837d41c70dd0237eb44ba1f4204ae9c2138f4d poddisruptionbudget-policy-v1.json
614e8878ac82099cccc0c55e90f487c09ced6057954cb1c5189f6cccc5799451 priorityclass-scheduling-v1.json
8fc372ed3e496e7013c0b331e29de074d5c73df391d2a9c4caa1059725ddd4eb replicaset-apps-v1.json
9546ed313e622ea84a0ab1ec7ef7e683f05acfbfe97beb746f0b5be6407691df resourcequota-v1.json
09e6af32ea82c8ed3ca322261d67de0a776ec79da15635a599e43e63afbec4af role-rbac-v1.json
005bd663d1ffdf7434209ea0808f9101a537f3d1bbba86c7dc97e062927b7fcf rolebinding-rbac-v1.json
de761ccb06bd1d2c641fb57397f61b68e7ff53a384f0817ce40e5ded8cee86f3 secret-v1.json
8bf019854daed511e7c174896a898173fa65d88ec5937c687a37303d4cc9351b service-v1.json
8193d6c3561475c6d3d5c44e1faedb1df53905373d904bc17015694326d659cf serviceaccount-v1.json
05cb2c0c4cb956b1e76ca1b3ecbfc90275b47f210fe5654e084d3c5d4f17eb10 statefulset-apps-v1.json
EOF
}

installed() {
  [ -f .tools/kubeconform ] || return 1
  {
    echo "$binary_sha  .tools/kubeconform"
    schemas | while read -r sha file; do echo "$sha  .tools/schemas/$file"; done
  } | sha256sum -c --status - 2>/dev/null
}

if installed; then
  echo "kubeconform $KUBECONFORM_VERSION and the Kubernetes v1.37.2 schemas are already in .tools/"
  exit 0
fi

mkdir -p .tools/schemas .tools/download
tarball=".tools/download/kubeconform-linux-$arch.tar.gz"
curl -fsSL --retry 3 -o "$tarball" \
  "https://github.com/yannh/kubeconform/releases/download/$KUBECONFORM_VERSION/kubeconform-linux-$arch.tar.gz"
echo "$tarball_sha  $tarball" | sha256sum -c - >/dev/null
tar -xzf "$tarball" -C .tools/download kubeconform
echo "$binary_sha  .tools/download/kubeconform" | sha256sum -c - >/dev/null
mv .tools/download/kubeconform .tools/kubeconform
chmod +x .tools/kubeconform

schemas | while read -r sha file; do
  curl -fsSL --retry 3 -o ".tools/download/$file" \
    "https://raw.githubusercontent.com/yannh/kubernetes-json-schema/$SCHEMA_COMMIT/$SCHEMA_DIR/$file"
  echo "$sha  .tools/download/$file" | sha256sum -c - >/dev/null
  mv ".tools/download/$file" ".tools/schemas/$file"
done

rm -rf .tools/download
echo "kubeconform $KUBECONFORM_VERSION ($arch) and Kubernetes v1.37.2 schemas are in .tools/"
