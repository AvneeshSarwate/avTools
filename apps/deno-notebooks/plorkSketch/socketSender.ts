#!/usr/bin/env deno run --allow-net

// Simple WebSocket client to send messages to the sketch server
// Run with: deno run --allow-net socketSender.ts

const ws = new WebSocket("ws://localhost:8080");

ws.onopen = () => {
  console.log("Connected to WebSocket server");
  
  // Send a test message
  const testMessage = {
    type: "test",
    content: "Hello from socket sender!",
    timestamp: new Date().toISOString()
  };
  
  console.log("Sending message:", testMessage);
  ws.send(JSON.stringify(testMessage));
  
  // Send a few more messages
  for (let i = 1; i <= 3; i++) {
    const message = {
      type: "message",
      content: `Test message ${i}`,
      count: i,
      timestamp: new Date().toISOString()
    };
    
    console.log(`Sending message ${i}:`, message);
    ws.send(JSON.stringify(message));
  }
};

ws.onmessage = (event) => {
  console.log("Received from server:", event.data);
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onclose = () => {
  console.log("WebSocket connection closed");
};