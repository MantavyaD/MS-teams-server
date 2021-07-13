// This is the signalling server between caller and callee, it listens to signals from one and passes to the second 
const twilio =require('twilio');
const cors = require('cors');
const express = require('express');
const socket = require('socket.io');
const { ExpressPeerServer } = require('peer');
const groupCallHandler = require('./groupCallHandler');
const { v4: uuidv4 } = require('uuid');
const port = process.env.PORT || 5000;

const app = express();

// cors will be used to connect frontend with backend
app.use(cors());

app.get('/', (req,res) => {
  res.send({api: 'video-talker-api'});
})

// getting the twilio turn credentials
app.get('/api/get-turn-credentials', (req,res) => {

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(accountSid,authToken);

  client.tokens.create().then((token) => res.send({token}))
})



const server = app.listen(port, () => {
  console.log(`server is listening on port ${port}`);
  console.log(`http://localhost:${port}`);
});

const peerServer = ExpressPeerServer(server, {
  debug: true
});


// middle-ware peerjs
app.use('/peerjs', peerServer);

// creating the peer server listeners
groupCallHandler.createPeerServerListeners(peerServer);


const io = socket(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// the active users
let peers = [];
// the rooms
let groupCallRooms = [];

const broadcastEventTypes = {
  ACTIVE_USERS: 'ACTIVE_USERS',
  GROUP_CALL_ROOMS: 'GROUP_CALL_ROOMS'
};

// connected to signalling server 
io.on('connection', (socket) => {
  socket.emit('connection', null);
  console.log('new user connected');
  console.log(socket.id);

  // new user added to peer list and broadcasted to all other users
  socket.on('register-new-user', (data) => {
    peers.push({
      username: data.username,
      socketId: data.socketId
    });
    console.log('registered new user');
    console.log(peers);

    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.ACTIVE_USERS,
      activeUsers: peers
    });

    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  // when a user disconnects it is removed from peer list and new list broadcasted to all other users
  socket.on('disconnect', () => {
    console.log('user disconnected');
    peers = peers.filter(peer => peer.socketId !== socket.id);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.ACTIVE_USERS,
      activeUsers: peers
    });

    groupCallRooms = groupCallRooms.filter(room => room.socketId !== socket.id);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  socket.on('disconnects', () => {
    console.log('user disconnected');
    peers = peers.filter(peer => peer.socketId !== socket.id);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.ACTIVE_USERS,
      activeUsers: peers
    });

    groupCallRooms = groupCallRooms.filter(room => room.socketId !== socket.id);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });


  // listeners related with direct call
  socket.on('pre-offer', (data) => {
    console.log('pre-offer handled');
    io.to(data.callee.socketId).emit('pre-offer', {
      callerUsername: data.caller.username,
      callerSocketId: socket.id
    });
  });

  socket.on('pre-offer-answer', (data) => {
    console.log('handling pre offer answer');
    io.to(data.callerSocketId).emit('pre-offer-answer', {
      answer: data.answer
    });
  });

  socket.on('webRTC-offer', (data) => {
    console.log('handling webRTC offer');
    io.to(data.calleeSocketId).emit('webRTC-offer', {
      offer: data.offer
    });
  });

  socket.on('webRTC-answer', (data) => {
    console.log('handling webRTC answer');
    io.to(data.callerSocketId).emit('webRTC-answer', {
      answer: data.answer
    });
  });

  socket.on('webRTC-candidate', (data) => {
    console.log('handling ice candidate');
    io.to(data.connectedUserSocketId).emit('webRTC-candidate', {
      candidate: data.candidate
    });
  });

  socket.on('user-hanged-up', (data) => {
    io.to(data.connectedUserSocketId).emit('user-hanged-up');
  });

  // listeners related with group call
  socket.on('group-call-register', (data) => {
    // a new roomID using uuidv4
    const roomId = uuidv4();
    socket.join(roomId);

    const newGroupCallRoom = {
      peerId: data.peerId,
      hostName: data.username,
      socketId: socket.id,
      roomId: roomId
    };

    // emmiting the new crated user to all active users
    groupCallRooms.push(newGroupCallRoom);
    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  // handling join request
  socket.on('group-call-join-request', (data) => {
    io.to(data.roomId).emit('group-call-join-request', {
      peerId: data.peerId,
      streamId: data.streamId
    });

    socket.join(data.roomId);
  });

  // handling user leaving
  socket.on('group-call-user-left', (data) => {
    if(data !== null)
    {
      socket.leave(data.roomId);
      io.to(data.roomId).emit('group-call-user-left', {
        streamId: data.streamId
      });
    }
  });

  // listener for meeting closed by host
  socket.on('group-call-closed-by-host', (data) => {
    groupCallRooms = groupCallRooms.filter(room => room.peerId !== data.peerId);

    io.sockets.emit('broadcast', {
      event: broadcastEventTypes.GROUP_CALL_ROOMS,
      groupCallRooms
    });
  });

  socket.on('message', (message) => {
     console.log('recieved at the backend');
     io.to(roomId).emit('create new message', message);
  });
});
