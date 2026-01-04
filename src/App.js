import React, { useState, useRef, useEffect, useCallback } from 'react';
import io from 'socket.io-client';

const SERVER_URL = 'http://localhost:5000'; // Backend server URL
const socket = io(SERVER_URL);

function App() {
  const [isTeacher, setIsTeacher] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usn, setUsn] = useState(''); // Unique Student Number
  const [sessionId, setSessionId] = useState('');
  const [inputSessionId, setInputSessionId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState(null); // { id, username, usn, isTeacher }
  const [isJoined, setIsJoined] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [peers, setPeers] = useState({}); // Stores RTCPeerConnection objects: {socketId: RTCPeerConnection}
  const localVideoRef = useRef(null); // Ref for the teacher's local screen share video element
  const [localStream, setLocalStream] = useState(null); // Stores the teacher's local screen share stream
  const participantVideoRefs = useRef({}); // Stores refs for all participant videos
  const [activeParticipants, setActiveParticipants] = useState({}); // Stores {socketId: {username, usn, isTeacher, stream}}

  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatBoxRef = useRef(null);

  // Scroll to bottom of chat box
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, showChat]);


  const createPeerConnection = useCallback((remoteSocketId, isInitiator) => {
    const peerConnection = new RTCPeerConnection({
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
      console.log(`Received track from ${remoteSocketId}`, event.streams[0]);
      setActiveParticipants(prev => ({
        ...prev,
        [remoteSocketId]: {
          ...prev[remoteSocketId],
          stream: event.streams[0]
        }
      }));
    };

    // Add local stream tracks if already available (e.g., teacher started sharing before student joined)
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
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
  }, [sessionId, localStream, setPeers, setActiveParticipants]); // Add localStream to dependencies


  useEffect(() => {
    // Socket.io listeners
    socket.on('session-created', (id) => {
      setSessionId(id);
      alert(`Session created with ID: ${id}`);
    });

    socket.on('student-joined', ({ studentSocketId, studentName, studentUsn }) => {
      console.log(`Student ${studentName} (${studentUsn}) joined: ${studentSocketId}`);
      setActiveParticipants(prev => ({
        ...prev,
        [studentSocketId]: { username: studentName, usn: studentUsn, isTeacher: false, stream: null }
      }));
      if (isTeacher) {
        createPeerConnection(studentSocketId, true);
      }
    });

    socket.on('teacher-joined', ({ teacherSocketId, teacherName }) => {
      console.log(`Teacher ${teacherName} joined: ${teacherSocketId}`);
      setActiveParticipants(prev => ({
        ...prev,
        [teacherSocketId]: { username: teacherName, usn: 'N/A', isTeacher: true, stream: null }
      }));
      // Student creates peer connection to teacher
      if (!isTeacher && loggedInUser && loggedInUser.id !== teacherSocketId) { // Ensure student creates PC to the teacher
        createPeerConnection(teacherSocketId, true);
      }
    });

    socket.on('participant-left', (participantSocketId) => {
      console.log(`Participant ${participantSocketId} left.`);
      if (peers[participantSocketId]) {
        peers[participantSocketId].close(); // FIX: Corrected typo here
        setPeers(prevPeers => {
          const newPeers = { ...prevPeers };
          delete newPeers[participantSocketId];
          return newPeers;
        });
      }
      setActiveParticipants(prev => {
        const newParticipants = { ...prev };
        delete newParticipants[participantSocketId];
        return newParticipants;
      });
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
      if (peers[senderSocketId]) {
        await peers[senderSocketId].setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('candidate', async ({ candidate, senderSocketId }) => {
      console.log('Received ICE candidate from:', senderSocketId);
      try {
        if (peers[senderSocketId]) {
          await peers[senderSocketId].addIceCandidate(candidate);
        }
      } catch (e) {
        console.error('Error adding received ICE candidate', e);
      }
    });

    socket.on('new-question', ({ question, studentId, studentName }) => {
      setQuestions(prevQuestions => [...prevQuestions, { question, studentId, studentName: studentName || 'Anonymous', timestamp: new Date().toLocaleTimeString() }]);
    });

    socket.on('new-message', ({ senderId, message, isPrivate, targetId, senderName }) => {
      setMessages(prevMessages => [
        ...prevMessages,
        {
          sender: senderName || 'Unknown',
          message,
          isPrivate,
          target: isPrivate ? (activeParticipants[targetId] ? activeParticipants[targetId].username : 'Unknown') : null,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    socket.on('session-ended', (id) => {
      if (sessionId === id) {
        alert('The teacher has ended the session.');
        leaveSession();
      }
    });

    socket.on('auth-failed', ({ message }) => {
      alert(`Authentication Failed: ${message}`);
      setIsLoggedIn(false);
      setLoggedInUser(null);
    });

    socket.on('join-failed', ({ message }) => {
      alert(`Join Session Failed: ${message}`);
      setIsJoined(false);
    });

    socket.on('join-success', ({ sessionId: receivedSessionId, user }) => {
      setSessionId(receivedSessionId);
      setIsJoined(true);
      setLoggedInUser(user);
      setActiveParticipants(prev => ({
        ...prev,
        [socket.id]: { username: user.username, usn: user.usn, isTeacher: user.isTeacher, stream: null }
      }));
    });


    return () => {
      socket.off('session-created');
      socket.off('student-joined');
      socket.off('teacher-joined');
      socket.off('participant-left');
      socket.off('offer');
      socket.off('answer');
      socket.off('candidate');
      socket.off('new-question');
      socket.off('new-message');
      socket.off('session-ended');
      socket.off('auth-failed');
      socket.off('join-failed');
      socket.off('join-success');
    };
  }, [isTeacher, sessionId, peers, activeParticipants, createPeerConnection, loggedInUser, localStream]);


  const startStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setActiveParticipants(prev => ({
        ...prev,
        [socket.id]: { ...prev[socket.id], stream: stream }
      }));


      Object.values(peers).forEach(peerConnection => {
        peerConnection.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'video') { // Only remove video tracks for new screen share
            peerConnection.removeTrack(sender);
          }
        });
        stream.getTracks().forEach(track => {
          peerConnection.addTrack(track, stream);
        });
      });

    } catch (err) {
      console.error("Error accessing media devices.", err);
      alert("Error starting screen share. Please ensure permissions are granted.");
    }
  };

  const stopStream = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      setActiveParticipants(prev => ({
        ...prev,
        [socket.id]: { ...prev[socket.id], stream: null }
      }));

      Object.values(peers).forEach(peerConnection => {
        peerConnection.getSenders().forEach(sender => {
          if (sender.track) {
            peerConnection.removeTrack(sender);
          }
        });
      });
    }
  };

  const handleAuth = async (type) => {
    const endpoint = isTeacher
      ? (type === 'signup' ? '/signup-teacher' : '/login-teacher')
      : (type === 'signup' ? '/signup-student' : '/login-student');

    const body = isTeacher
      ? { username, password }
      : { username, usn, password };

    try {
      const response = await fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        alert(data.message);
        setIsLoggedIn(true);
        setLoggedInUser({ ...data.user, isTeacher: isTeacher });
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (error) {
      console.error(`Error during ${type} for ${isTeacher ? 'teacher' : 'student'}:`, error);
      alert(`Network error during ${type}.`);
    }
  };

  const joinSession = () => {
    console.log('Attempting to join session...');
    console.log('loggedInUser:', loggedInUser);
    console.log('isTeacher state:', isTeacher);

    if (isLoggedIn && loggedInUser) {
      let currentSessionId = inputSessionId;
      if (isTeacher && !inputSessionId) {
        currentSessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
      }

      if (currentSessionId) {
        socket.emit('join-session', {
          sessionId: currentSessionId,
          isTeacher: loggedInUser.isTeacher,
          username: loggedInUser.username,
          usn: loggedInUser.usn || '',
          password: password
        });
      } else {
        alert('Please enter a Session ID.');
      }
    } else {
      alert('Please log in or sign up first.');
    }
  };

  const leaveSession = () => {
    socket.disconnect();
    setIsJoined(false);
    setSessionId('');
    setUsername('');
    setPassword('');
    setUsn('');
    setQuestions([]);
    setMessages([]);
    setPeers({});
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    setLocalStream(null);
    setActiveParticipants({});
    setLoggedInUser(null);
    setIsLoggedIn(false);
    if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
    }
  };

  const sendQuestion = () => {
    if (newQuestion.trim() && sessionId && loggedInUser && !loggedInUser.isTeacher) {
      socket.emit('send-question', { sessionId, question: newQuestion, studentId: socket.id });
      setNewQuestion('');
    } else if (loggedInUser.isTeacher) {
      alert('Teachers cannot ask questions.');
    } else {
      alert('Please type a question and ensure you are in a session and logged in as a student.');
    }
  };

  const sendMessage = (isPrivate = false, targetId = null) => {
    if (chatInput.trim() && sessionId && loggedInUser) {
      socket.emit('send-message', { sessionId, message: chatInput, senderId: socket.id, isPrivate, targetId, senderName: loggedInUser.username });
      setChatInput('');
    } else {
      alert('Please type a message and ensure you are in a session.');
    }
  };

  const downloadAttendance = async () => {
    if (!sessionId) {
      alert('Please join a session first to download attendance.');
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/download-attendance/${sessionId}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_session_${sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        const errorData = await response.json();
        alert(`Failed to download attendance: ${errorData.message}`);
      }
    } catch (error) {
      console.error('Error downloading attendance:', error);
      alert('Error downloading attendance due to network issues.');
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">{isTeacher ? 'Teacher' : 'Student'} Login / Signup</h1>
          <div className="mb-4 flex justify-center space-x-4">
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio text-blue-600"
                value="teacher"
                checked={isTeacher}
                onChange={() => setIsTeacher(true)}
              />
              <span className="ml-2 text-gray-700">Teacher</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio text-blue-600"
                value="student"
                checked={!isTeacher}
                onChange={() => setIsTeacher(false)}
              />
              <span className="ml-2 text-gray-700">Student</span>
            </label>
          </div>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Enter Your Name" // For teacher username, student username
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          {!isTeacher && (
            <div className="mb-4">
              <input
                type="text"
                placeholder="Enter Your USN (Unique Student Number)"
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={usn}
                onChange={(e) => setUsn(e.target.value)}
              />
            </div>
          )}
          <div className="mb-6">
            <input
              type="password"
              placeholder="Enter Password"
              className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => handleAuth('signup')}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50"
            >
              Sign Up
            </button>
            <button
              onClick={() => handleAuth('login')}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
            >
              Log In
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">Join Session</h1>
          <p className="text-center text-gray-600 mb-4">Logged in as: <span className="font-semibold">{loggedInUser?.username} ({isTeacher ? 'Teacher' : loggedInUser?.usn})</span></p>
          {!isTeacher && (
            <div className="mb-6">
              <input
                type="text"
                placeholder="Enter Session ID"
                className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={inputSessionId}
                onChange={(e) => setInputSessionId(e.target.value)}
              />
            </div>
          )}
          <button
            onClick={joinSession}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
          >
            {isTeacher ? 'Start New Session' : 'Join Session'}
          </button>
          <button
            onClick={leaveSession} // This acts as a logout when not in session
            className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-md mt-4"
          >
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-blue-600 text-white p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">{isTeacher ? 'Teacher Session' : 'Student Session'}</h1>
        <div className="flex items-center space-x-4">
          <p className="text-lg">Session ID: <span className="font-semibold">{sessionId}</span></p>
          <p className="text-lg">User: <span className="font-semibold">{loggedInUser?.username}</span></p>
          <button
            onClick={leaveSession}
            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-md"
          >
            Leave Session
          </button>
          <button
            onClick={() => setShowChat(!showChat)}
            className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-md"
          >
            {showChat ? 'Hide Chat' : 'Show Chat'}
          </button>
          {isTeacher && (
            <button
              onClick={downloadAttendance}
              className="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded-md"
            >
              Download Attendance
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Main Video Area */}
        <div className={`flex-1 p-4 flex flex-col items-center justify-center ${showChat ? 'w-2/3' : 'w-full'} transition-all duration-300`}>
          {/* Teacher's local stream (if sharing) */}
          {isTeacher && localStream && (
            <div className="w-full max-w-4xl bg-gray-800 rounded-lg shadow-lg overflow-hidden relative mb-4">
              <video ref={localVideoRef} autoPlay muted className="w-full h-auto rounded-lg" srcObject={localStream}></video>
              <div className="absolute bottom-4 left-4 right-4 flex justify-center space-x-4">
                <button onClick={startStream} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full">Start Screen Share</button>
                <button onClick={stopStream} className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-full">Stop Screen Share</button>
              </div>
            </div>
          )}
          {isTeacher && !localStream && (
             <div className="w-full max-w-4xl bg-gray-800 rounded-lg shadow-lg overflow-hidden relative mb-4 flex items-center justify-center h-96 text-white text-xl">
               <button onClick={startStream} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full">Start Screen Share</button>
             </div>
          )}


          {/* Participant Grid for Students and Remote Streams for Teacher */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-6xl">
            {Object.entries(activeParticipants)
              .filter(([id]) => !(id === socket.id && isTeacher && localStream)) // If teacher is sharing via localVideoRef, don't show their stream twice in the grid
              .map(([id, participant]) => (
              <div key={id} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden relative">
                <video
                  ref={el => participantVideoRefs.current[id] = el}
                  autoPlay
                  muted={id === socket.id} // Mute local video if it's the current user's stream
                  className="w-full h-auto rounded-lg"
                  srcObject={participant.stream}
                ></video>
                <p className="absolute bottom-2 left-2 text-white bg-black bg-opacity-50 px-2 py-1 rounded-md text-sm">
                  {participant.username} {participant.isTeacher ? '(Teacher)' : '(Student)'}
                </p>
                {!participant.stream && (
                  <div className="absolute inset-0 flex items-center justify-center text-white text-xl bg-gray-900 bg-opacity-75">
                    {participant.isTeacher && !isTeacher ? "Waiting for teacher to share screen..." : "Waiting for stream..."}
                  </div>
                )}
              </div>
            ))}
            {Object.keys(activeParticipants).length === 0 && (
              <div className="flex items-center justify-center h-48 bg-gray-200 rounded-lg text-gray-500 text-xl col-span-full">
                No participants yet.
              </div>
            )}
          </div>

          {isTeacher && (
            <div className="mt-8 w-full max-w-4xl">
              <h2 className="text-2xl font-semibold mb-4 text-gray-800">Questions from Students:</h2>
              <div className="bg-white p-4 rounded-lg shadow-md max-h-60 overflow-y-auto">
                {questions.length === 0 ? (
                  <p className="text-gray-600">No questions yet.</p>
                ) : (
                  questions.map((q, index) => (
                    <div key={index} className="mb-2 p-2 bg-gray-50 rounded-md">
                      <p className="text-gray-800">
                        <strong className="text-blue-600">{q.studentName || 'Anonymous Student'}:</strong> {q.question} <em className="text-gray-500 text-sm">({q.timestamp})</em>
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {!isTeacher && (
            <div className="mt-8 w-full max-w-xl">
              <h2 className="text-2xl font-semibold mb-4 text-gray-800">Ask a Question:</h2>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="Type your question here"
                  className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                />
                <button onClick={sendQuestion} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md">Send Question</button>
              </div>
            </div>
          )}
        </div>

        {/* Chat Popup */}
        <div className={`fixed right-0 top-0 h-full bg-white shadow-lg z-50 transform ${showChat ? 'translate-x-0' : 'translate-x-full'} transition-transform duration-300 ease-in-out w-96 flex flex-col`}>
          <div className="flex justify-between items-center p-4 border-b">
            <h2 className="text-xl font-bold">Chat</h2>
            <button onClick={() => setShowChat(false)} className="text-gray-600 hover:text-gray-900 text-2xl">&times;</button>
          </div>
          <div ref={chatBoxRef} className="flex-1 p-4 overflow-y-auto">
            {messages.length === 0 ? (
              <p className="text-gray-500">No messages yet.</p>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className="mb-2">
                  <span className="font-semibold">{msg.sender}{msg.isPrivate ? ` (private to ${msg.target})` : ''}: </span>
                  <span>{msg.message}</span>
                  <span className="text-xs text-gray-500 ml-2">{msg.timestamp}</span>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t">
            <input
              type="text"
              placeholder="Type your message..."
              className="w-full px-4 py-2 border rounded-md mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => { if (e.key === 'Enter') sendMessage(); } }
            />
            <div className="flex space-x-2">
              <button onClick={() => sendMessage()} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md">Send Public</button>
              {/* TODO: Add dropdown to select private recipient */}
              <button onClick={() => alert('Private chat coming soon!')} className="flex-1 bg-gray-400 text-white font-bold py-2 px-4 rounded-md cursor-not-allowed">Send Private</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
