import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import './App.css';

const SERVER_URL = 'http://localhost:5000'; // Backend server URL
const socket = io(SERVER_URL);

function App() {
  const [isTeacher, setIsTeacher] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [inputSessionId, setInputSessionId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [peers, setPeers] = useState({}); // Stores RTCPeerConnection objects
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    // Socket.io listeners
    socket.on('session-created', (id) => {
      setSessionId(id);
      alert(`Session created with ID: ${id}`);
    });

    socket.on('student-joined', (studentSocketId) => {
      console.log(`Student ${studentSocketId} joined.`);
      // For WebRTC: Teacher initiates offer to new student
      if (isTeacher) {
        createPeerConnection(studentSocketId, true);
      }
    });

    socket.on('student-left', (studentSocketId) => {
      console.log(`Student ${studentSocketId} left.`);
      // Close peer connection if student leaves
      if (peers[studentSocketId]) {
        peers[studentSocketId].close();
        setPeers(prevPeers => {
          const newPeers = { ...prevPeers };
          delete newPeers[studentSocketId];
          return newPeers;
        });
      }
    });

    socket.on('offer', async ({ offer, senderSocketId }) => {
      console.log('Received offer from:', senderSocketId);
      const peer = createPeerConnection(senderSocketId, false);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('answer', { answer, targetSocketId: senderSocketId, sessionId });
    });

    socket.on('answer', async ({ answer, senderSocketId }) => {
      console.log('Received answer from:', senderSocketId);
      await peers[senderSocketId].setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('candidate', async ({ candidate, senderSocketId }) => {
      console.log('Received ICE candidate from:', senderSocketId);
      try {
        await peers[senderSocketId].addIceCandidate(candidate);
      } catch (e) {
        console.error('Error adding received ICE candidate', e);
      }
    });

    socket.on('new-question', ({ question, studentId }) => {
      setQuestions(prevQuestions => [...prevQuestions, { question, studentId, timestamp: new Date().toLocaleTimeString() }]);
    });

    socket.on('session-ended', (id) => {
      if (sessionId === id) {
        alert('The teacher has ended the session.');
        leaveSession();
      }
    });

    return () => {
      socket.off('session-created');
      socket.off('student-joined');
      socket.off('student-left');
      socket.off('offer');
      socket.off('answer');
      socket.off('candidate');
      socket.off('new-question');
      socket.off('session-ended');
    };
  }, [isTeacher, sessionId, peers]);

  // WebRTC setup
  const createPeerConnection = (remoteSocketId, isInitiator) => {
    const peerConnection = new RTCPeerConnection({
      // This is a placeholder for STUN/TURN servers. For LAN-only, 
      // it might work without, but for more complex network topologies,
      // a locally hosted STUN server or TURN server might be needed.
      // For this project, we assume a simple LAN where direct peer connection is possible.
      // If you need STUN/TURN for your LAN setup, you would add it here.
      // ⚠️ DEMO / PLACEHOLDER: STUN server URL. Replace if needed.
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' } 
      ]
    });

    setPeers(prevPeers => ({ ...prevPeers, [remoteSocketId]: peerConnection }));

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('candidate', { candidate: event.candidate, targetSocketId: remoteSocketId, sessionId });
      }
    };

    peerConnection.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => {
        peerConnection.addTrack(track, localVideoRef.current.srcObject);
      });
    }

    if (isInitiator) {
      peerConnection.onnegotiationneeded = async () => {
        try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit('offer', { offer: peerConnection.localDescription, targetSocketId: remoteSocketId, sessionId });
        } catch (e) {
          console.error('Error creating offer', e);
        }
      };
    }

    return peerConnection;
  };

  const startStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      // Add tracks to all existing peer connections
      Object.values(peers).forEach(peerConnection => {
        stream.getTracks().forEach(track => {
          peerConnection.addTrack(track, stream);
        });
      });

    } catch (err) {
      console.error("Error accessing media devices.", err);
    }
  };

  const stopStream = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      localVideoRef.current.srcObject = null;
      // Remove tracks from all peer connections
      Object.values(peers).forEach(peerConnection => {
        peerConnection.getSenders().forEach(sender => {
          if (sender.track) {
            peerConnection.removeTrack(sender);
          }
        });
      });
    }
  };

  const joinSession = () => {
    if (inputSessionId) {
      socket.emit('join-session', { sessionId: inputSessionId, isTeacher });
      setSessionId(inputSessionId);
      setIsJoined(true);
    } else if (isTeacher) {
      // Teacher creates a new session by joining a random ID
      const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
      socket.emit('join-session', { sessionId: newId, isTeacher });
      setSessionId(newId);
      setIsJoined(true);
    }
  };

  const leaveSession = () => {
    socket.disconnect(); // Disconnects the socket
    setIsJoined(false);
    setSessionId('');
    setQuestions([]);
    setPeers({});
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    // Reconnect socket for future use if needed, or refresh page
    // window.location.reload(); // Simple way to reset everything
  };

  const sendQuestion = () => {
    if (newQuestion.trim() && sessionId) {
      socket.emit('send-question', { sessionId, question: newQuestion, studentId: socket.id });
      setNewQuestion('');
    }
  };

  if (!isJoined) {
    return (
      <div className="App">
        <h1>Join Classroom</h1>
        <div>
          <label>
            <input
              type="radio"
              value="teacher"
              checked={isTeacher}
              onChange={() => setIsTeacher(true)}
            />
            Teacher
          </label>
          <label>
            <input
              type="radio"
              value="student"
              checked={!isTeacher}
              onChange={() => setIsTeacher(false)}
            />
            Student
          </label>
        </div>
        {!isTeacher && (
          <div>
            <input
              type="text"
              placeholder="Enter Session ID"
              value={inputSessionId}
              onChange={(e) => setInputSessionId(e.target.value)}
            />
          </div>
        )}
        <button onClick={joinSession}>
          {isTeacher ? 'Start New Session' : 'Join Session'}
        </button>
      </div>
    );
  }

  return (
    <div className="App">
      <h1>{isTeacher ? 'Teacher Session' : 'Student Session'}</h1>
      <p>Session ID: {sessionId}</p>
      <button onClick={leaveSession}>Leave Session</button>

      {/* Video Streams */}
      <div className="video-container">
        {isTeacher && <video ref={localVideoRef} autoPlay muted className="local-video"></video>}
        <video ref={remoteVideoRef} autoPlay className="remote-video"></video>
      </div>

      {isTeacher && (
        <div className="teacher-controls">
          <button onClick={startStream}>Start Screen Share</button>
          <button onClick={stopStream}>Stop Screen Share</button>
          <h2>Questions from Students:</h2>
          <div className="questions-list">
            {questions.length === 0 ? (
              <p>No questions yet.</p>
            ) : (
              questions.map((q, index) => (
                <div key={index} className="question-item">
                  <p><strong>Anonymous Student:</strong> {q.question} <em>({q.timestamp})</em></p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {!isTeacher && (
        <div className="student-controls">
          <h2>Ask a Question:</h2>
          <input
            type="text"
            placeholder="Type your question here"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
          />
          <button onClick={sendQuestion}>Send Question</button>
        </div>
      )}
    </div>
  );
}

export default App;
