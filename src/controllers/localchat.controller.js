// socket/ticketTaskReplyHub.ts
const { io } = require("../app");
 
export function ticketTaskReplyHub(socket) {
  console.log('✅ Socket connected:', socket.id);

  // Join Group
  socket.on('JoinTicketGroup', (ticketId) => {
    socket.join(ticketId);
    console.log(`🔗 Joined room: ${ticketId}`);
  });

  // Leave Group
  socket.on('LeaveTicketGroup', (ticketId) => {
    socket.leave(ticketId);
    console.log(`🚪 Left room: ${ticketId}`);
  });

  // Receive Ticket Task Reply (broadcast to room)
  socket.on('SendMessage', (msg) => {
    const eventName = `ReceiveTicketTaskReply${msg.CmpId}${msg.TicketId}${msg.RouteId}${msg.RemindId}`;
    socket.to(msg.TicketId).emit(eventName, msg); // ใช้ socket.to เพื่อไม่ส่งกลับคนที่ส่ง
    console.log(`📤 Emit to ${msg.TicketId}: ${eventName}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
}
