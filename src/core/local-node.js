const { exec: cpExec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(cpExec);

/**
 * Local node — executes commands on the local machine.
 * Implements the same interface as RemoteNode so server.js can use either.
 */
class LocalNode {
  constructor() {
    this.id = 'local';
    this.type = 'local';
    this.connected = true;
  }

  async exec(cmd) {
    try {
      const { stdout } = await execAsync(cmd, { encoding: 'utf8', timeout: 10000 });
      return stdout;
    } catch {
      return '';
    }
  }

  async capturePane(target, { lines } = {}) {
    const scrollback = lines ? `-S -${lines}` : '';
    const result = await this.exec(`tmux capture-pane -t "${target}" -p ${scrollback} 2>/dev/null`);
    return result || '';
  }

  async sendKeys(target, keys, enter = true) {
    const oneLine = keys.replace(/\r?\n+/g, ' — ');
    const escaped = oneLine.replace(/'/g, "'\\''");
    await this.exec(`tmux send-keys -t "${target}" -l '${escaped}'`);
    if (enter) await this.exec(`tmux send-keys -t "${target}" Enter`);
  }

  disconnect() {}
}

/**
 * Local router — always returns the local node.
 * Used when hive runs on a single machine without remote workers.
 */
class LocalRouter {
  constructor() {
    this.node = new LocalNode();
  }

  getNode(_id) {
    return this.node;
  }

  nodeFor(_sessionName) {
    return this.node;
  }

  addNode() {}
  removeNode() {}
}

module.exports = { LocalNode, LocalRouter };
