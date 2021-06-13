const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const node = __dirname;

// Generate a new build ID.
const buildId = `${currentPlatform()}-node-${makeDate()}-${makeRandomId()}`;

fs.writeFileSync(
  `${node}/src/node_build_id.cc`,
  `namespace node { char gBuildId[] = "${buildId}"; }`
);

// Download the latest record/replay driver.
const driverFile = `${currentPlatform()}-recordreplay.so`;
spawnChecked("wget", [`https://replay.io/downloads/${driverFile}`], { stdio: "inherit" });

// Embed the driver in the source.
const driverContents = fs.readFileSync(driverFile);
fs.unlinkSync(driverFile);
let driverString = "";
for (let i = 0; i < driverContents.length; i++) {
  driverString += `\\${driverContents[i].toString(8)}`;
}
fs.writeFileSync(
  `${node}/src/node_record_replay_driver.cc`,
  `
namespace node {
  char gRecordReplayDriver[] = "${driverString}";
  int gRecordReplayDriverSize = ${driverContents.length};
}
`
);

const numCPUs = os.cpus().length;

if (process.platform == "linux") {
  // Do the build inside a container, to ensure a consistent result
  // with the right glibc dependencies and so forth.
  if (process.env.BUILD_NODE_CONTAINER) {
    spawnChecked(
      "docker",
      ["build", ".", "-f", `${node}/Dockerfile.build`, "-t", "node-build"],
      { stdio: "inherit" }
    );
  }
  spawnChecked("docker", ["run", "-v", `${node}:/node`, "node-build"], {
    stdio: "inherit",
  });
} else {
  if (process.env.CONFIGURE_NODE) {
    spawnChecked(`${node}/configure`, [], { cwd: node, stdio: "inherit" });
  }
  spawnChecked("make", [`-j${numCPUs}`, "-C", "out", "BUILDTYPE=Release"], {
    cwd: node,
    stdio: "inherit",
  });
}

function spawnChecked(cmd, args, options) {
  const prettyCmd = [cmd].concat(args).join(" ");
  console.error(prettyCmd);

  const rv = spawnSync(cmd, args, options);

  if (rv.status != 0 || rv.error) {
    console.error(rv.error);
    throw new Error(`Spawned process failed with exit code ${rv.status}`);
  }

  return rv;
}

function currentPlatform() {
  switch (process.platform) {
    case "darwin":
      return "macOS";
    case "linux":
      return "linux";
    default:
      throw new Error(`Platform ${process.platform} not supported`);
  }
}

function makeDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const date = now.getDate().toString().padStart(2, "0");
  return `${year}${month}${date}`;
}

function makeRandomId() {
  return Math.round(Math.random() * 1e9).toString();
}
