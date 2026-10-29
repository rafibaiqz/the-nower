/** Socket.IO implementation of the transport (Node.js deployments). */
import type { Server, Socket } from 'socket.io';
import type { Conn, Hub } from './transport';

const wrappers = new WeakMap<Socket, Conn>();

export function wrapSocket(socket: Socket): Conn {
  let c = wrappers.get(socket);
  if (!c) {
    c = {
      id: socket.id,
      emit: (event, data) => void socket.emit(event, data),
      join: (room) => void socket.join(room),
      leave: (room) => void socket.leave(room),
      disconnect: () => void socket.disconnect(true),
      on: (event, handler) => void socket.on(event, handler),
    };
    wrappers.set(socket, c);
  }
  return c;
}

export function socketIoHub(io: Server): Hub {
  return {
    toRoom: (room, event, data, volatile) => void (volatile ? io.to(room).volatile.emit(event, data) : io.to(room).emit(event, data)),
    toConn: (id, event, data) => void io.to(id).emit(event, data),
    get: (id) => {
      const s = io.sockets.sockets.get(id);
      return s ? wrapSocket(s) : undefined;
    },
  };
}
