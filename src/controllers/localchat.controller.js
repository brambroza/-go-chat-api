// controllers/localchat.controller.js

function ticketTaskReplyHub(socket) {
  console.log('✅ Socket connected to localchat.controller:', socket.id);

  socket.on('JoinTicketGroup', (ticketId) => {
    socket.join(ticketId);
    console.log(`🔗 Joined room: ${ticketId}`);
  });

  socket.on('LeaveTicketGroup', (ticketId) => {
    socket.leave(ticketId);
    console.log(`🚪 Left room: ${ticketId}`);
  });

  socket.on('SendMessage', (msg) => {
    const eventName = `ReceiveTicketTaskReply${msg.CmpId}${msg.TicketId}${msg.RouteId}${msg.RemindId}`;
    socket.to(msg.TicketId).emit(eventName, msg);
    console.log(`📤 Emit to ${msg.TicketId}: ${eventName}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
}

module.exports = ticketTaskReplyHub;
