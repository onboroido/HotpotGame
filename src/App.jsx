import { useState, useEffect, useCallback } from 'react'
import './App.css'
import { db } from './firebase'; 
import { ref, onValue, set, update, push, onDisconnect, get } from "firebase/database";

const CARD_TYPES = [
  { id: 1, name: '人参', category: '野菜', color: '#e67e22', icon: '🥕' },
  { id: 2, name: '玉ねぎ', category: '野菜', color: '#e67e22', icon: '🧅' },
  { id: 3, name: 'ジャガイモ', category: '野菜', color: '#e67e22', icon: '🥔' },
  { id: 4, name: '肉', category: '肉類', color: '#c0392b', icon: '🥩' },
  { id: 5, name: '鶏肉', category: '肉類', color: '#c0392b', icon: '🍗' },
  { id: 6, name: 'ソーセージ', category: '肉類', color: '#c0392b', icon: '🌭' },
  { id: 7, name: 'エビ', category: '魚介', color: '#2980b9', icon: '🦐' },
  { id: 8, name: 'カニ', category: '魚介', color: '#2980b9', icon: '🦀' },
  { id: 9, name: '魚', category: '魚介', color: '#2980b9', icon: '🐟' },
  { id: 10, name: '白菜', category: '葉物', color: '#27ae60', icon: '🥬' },
  { id: 11, name: 'ネギ', category: '葉物', color: '#27ae60', icon: '🎋' },
  { id: 12, name: 'ニラ', category: '葉物', color: '#27ae60', icon: '🌿' },
];

function App() {
  const [gameMode, setGameMode] = useState(null);
  // URLからroomIdを確実に取得
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || "";
  });
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState({});
  const [gameStatus, setGameStatus] = useState("waiting");
  const [playerName, setPlayerName] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [deck, setDeck] = useState([]);
  const [slots, setSlots] = useState([null, null, null, null]);
  const [turn, setTurn] = useState(0);
  const [round, setRound] = useState(1);
  const [gameLog, setGameLog] = useState("準備中...");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [lastWinDetails, setLastWinDetails] = useState({ total: 0 });
  const [hand, setHand] = useState([]); 
  const [totalScore, setTotalScore] = useState(0);

  const getInviteUrl = () => `${window.location.origin}${window.location.pathname}?room=${roomId}`;

  // ランキング表示の修正（ダミーデータを排除）
  const getRanking = () => {
    if (gameMode === "online") {
      return Object.keys(players).map(id => ({
        name: players[id].name || "不明",
        score: players[id].score || 0,
        isMe: id === myId
      })).sort((a, b) => b.score - a.score);
    }
    // CPU戦は初期値を0に固定
    return [
      { name: "あなた", score: totalScore, isMe: true },
      { name: "CPU 1", score: 0, isMe: false },
      { name: "CPU 2", score: 0, isMe: false },
      { name: "CPU 3", score: 0, isMe: false }
    ].sort((a, b) => b.score - a.score);
  };

  const startAction = useCallback(async (resetGame = false) => {
    const fullDeck = [];
    CARD_TYPES.forEach(type => { for(let i=0; i<5; i++) fullDeck.push({...type, instanceId: Math.random()}); });
    fullDeck.sort(() => Math.random() - 0.5);
    const nextRound = resetGame ? 1 : round + 1;

    if (gameMode === "cpu") {
      if (resetGame) setTotalScore(0);
      setRound(nextRound);
      setHand([...fullDeck.splice(0, 8)].sort((a,b)=>a.id-b.id));
      setDeck(fullDeck);
      setSlots([null, null, null, null]);
      setGameStatus("playing");
      setTurn(0);
      setHasDrawn(false);
      setGameLog(`第${nextRound}ラウンド開始！`);
    } else {
      const roomRef = ref(db, `rooms/${roomId}`);
      const updates = {};
      const pIds = Object.keys(players);
      pIds.forEach(id => {
        updates[`players/${id}/hand`] = [...fullDeck.splice(0, 8)].sort((a,b)=>a.id-b.id);
        if (resetGame) updates[`players/${id}/score`] = 0;
      });
      updates['round'] = nextRound;
      updates['status'] = "playing";
      updates['deck'] = fullDeck;
      updates['slots'] = [null, null, null, null];
      updates['turn'] = 0;
      updates['hasDrawn'] = false;
      updates['log'] = `第${nextRound}ラウンド開始！`;
      await update(roomRef, updates);
    }
  }, [gameMode, round, players, roomId, totalScore]);

  // Firebase監視の修正
  useEffect(() => {
    if (gameMode !== "online" || !roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setPlayers(data.players || {});
        setGameStatus(data.status || "waiting");
        setDeck(data.deck || []);
        setSlots(data.slots || [null, null, null, null]);
        setTurn(data.turn || 0);
        setRound(data.round || 1);
        setGameLog(data.log || "");
        setHasDrawn(data.hasDrawn || false);
      }
    });
    return () => unsubscribe();
  }, [gameMode, roomId]);

  // URLにRoomIDがある場合に自動でオンラインモードへ
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    if (r && !gameMode) {
      setRoomId(r);
      setGameMode("online");
    }
  }, [gameMode]);

  // --- UI Components ---
  if (!gameMode) return (
    <div className="game-container menu-bg">
      <div className="start-screen main-menu">
        <h1 className="title-large">🍲 Hotpot Game</h1>
        <div className="menu-buttons">
          <button onClick={() => { setGameMode("cpu"); setGameStatus("playing"); }} className="mega-button">CPUと対戦</button>
          <button onClick={() => {
            const newId = Math.random().toString(36).substring(2,7);
            setRoomId(newId);
            setGameMode("online");
            window.history.pushState({}, '', `?room=${newId}`);
          }} className="mega-button">新しく部屋を作る</button>
        </div>
      </div>
    </div>
  );

  if (gameMode === "online" && !isJoined) return (
    <div className="game-container">
      <div className="start-screen">
        <h2 className="section-title">プレイヤー登録</h2>
        <p className="room-id-display">Room: {roomId}</p>
        <input type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="name-input-large" placeholder="名前を入力" />
        <button onClick={async () => {
          if (!playerName.trim()) return;
          const pRef = push(ref(db, `rooms/${roomId}/players`));
          setMyId(pRef.key);
          await set(pRef, { name: playerName, hand: [], score: 0 });
          onDisconnect(pRef).remove();
          setIsJoined(true);
        }} className="mega-button">参加する</button>
      </div>
    </div>
  );

  // CPU戦の自動開始
  if (gameMode === "cpu" && gameStatus === "playing" && hand.length === 0) {
    startAction(true);
  }

  // 以下、レンダリング部分は前回と同じ（ランキング表示の修正が適用されます）
  // ... (省略: 前回の return 内容をそのまま使用)