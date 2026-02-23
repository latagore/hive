/**
 * Stub for RemoteNode — placeholder for remote worker node support.
 */
class RemoteNode {
  constructor(id, ws) {
    this.id = id;
    this.ws = ws;
    this.type = 'worker';
    this.connected = true;
  }
}

module.exports = RemoteNode;
