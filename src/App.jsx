import { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'; 
import { ref, onValue, set, update, push, onDisconnect, serverTimestamp } from "firebase/database";

// 1. カード定義（12種類、新カテゴリー、最適化された絵文字）
const CARD_TYPES = [
  { id: 1, name: '人参', category: 'オレンジ', color: '#e67e22', icon: '🥕' },
  { id: 2, name: '玉ねぎ', category: 'オレンジ', color: '#e67e22', icon: '🧅' },
  { id: 3, name: 'ジャガイモ', category: 'オレンジ', color: '#e67e22', icon: '🥔' },
  { id: 4, name: '肉', category: '赤', color: '#c0392b', icon: '🥩' },
  { id: 5, name: '鶏肉', category: '赤', color: '#c0392b', icon: '🍗' },
  { id: 6, name: 'ソーセージ', category: '赤', color: '#c0392b', icon: '🌭' },
  { id: 7, name: 'エビ', category: '青', color: '#2980b9', icon: '🦐' },
  { id: 8, name: 'カニ', category: '青', color: '#2980b9', icon: '🦀' },
  { id: 9, name: '魚', category: '青', color: '#2980b9', icon: '🐟' },
  { id: 10, name: '白菜', category: '緑', color: '#27ae60', icon: '🥬' },
  { id: 11, name: 'ネギ', category: '緑', color: '#27ae60', icon: '🎋' }, // 代用
  { id: 12, name: 'ニラ', category: '緑', color: '#27ae60', icon: '🌿' }, // 代用
];

function App() {
  const [gameMode, setGameMode] = useState(null);
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room');
  });
  const [myId, setMyId] = useState(null);
  const [players, setPlayers] = useState({});
  const [gameStatus, setGameStatus] = useState("waiting");
  const [playerName, setPlayerName] = useState("");
  const [isJoined, setIsJoined] = useState(false);

  const [deck, setDeck] = useState([]);
  const [slots, setSlots] = useState([null, null, null, null]);
  const [turn, setTurn] = useState(0);
  const [gameLog, setGameLog] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [lastWinDetails, setLastWinDetails] = useState({ total: 0, breakdown: [] });
  
  const [hand, setHand] = useState([]); 
  const [cpuHands, setCpuHands] = useState([[], [], []]);

  // オンライン同期
  useEffect(() => {
    if (gameMode !== "online") return;
    let currentRoomId = roomId;
    if (!currentRoomId) {
      currentRoomId = Math.random().toString(36).substring(2, 7);
      setRoomId(currentRoomId);
      window.history.pushState({}, '', `?room=${currentRoomId}`);
    }
    const roomRef = ref(db, `rooms/${currentRoomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setPlayers(data.players || {});
        setGameStatus(data.status || "waiting");
        setDeck(data.deck || []);
        setSlots(data.slots || [null, null, null, null]);
        setTurn(data.turn || 0);
        setGameLog(data.log || "");
        setHasDrawn(data.hasDrawn || false);
        if (data.lastWinDetails) setLastWinDetails(data.lastWinDetails);
      }
    });
    return () => unsubscribe();
  }, [gameMode, roomId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('room')) setGameMode("online");
  }, []);

  // CPU思考ロジック
  useEffect(() => {
    if (gameMode === "cpu" && gameStatus === "playing" && turn !== 0) {
      const timer = setTimeout(() => {
        let currentCpuIdx = turn - 1; 
        if (!cpuHands[currentCpuIdx]) return;

        let h = [...cpuHands[currentCpuIdx]];
        let newDeck = [...deck];
        let newSlots = [...slots];
        
        let picked;
        const prevTurnIdx = (turn === 0) ? 3 : turn - 1;
        
        if (newSlots[prevTurnIdx] && Math.random() > 0.85) {
          picked = newSlots[prevTurnIdx];
          newSlots[prevTurnIdx] = null;
        } else if (newDeck.length > 0) {
          picked = newDeck.pop();
        } else {
          newDeck = newSlots.filter(s => s !== null).sort(() => Math.random() - 0.5);
          newSlots = [null, null, null, null];
          picked = newDeck.pop();
        }

        if (!picked) return;
        h.push(picked);
        const dIdx = Math.floor(Math.random() * h.length);
        const discarded = h.splice(dIdx, 1)[0];
        newSlots[turn] = discarded;

        setCpuHands(prev => {
          let n = [...prev];
          n[currentCpuIdx] = h;
          return n;
        });
        setSlots(newSlots);
        setDeck(newDeck);
        setGameLog(`CPU ${turn}が${discarded.name}を捨てました`);

        const processed = getProcessedHand(h);
        if (processed.filter(c => c.isCompleted).length === 9) {
          setGameStatus("finished");
          setLastWinDetails(calculateScore(h, false));
          setGameLog(`CPU ${turn}の上がり！`);
        } else {
          setTurn((turn + 1) % 4);
        }
      }, 1000); 
      return () => clearTimeout(timer);
    }
  }, [turn, gameStatus, gameMode, cpuHands, deck, slots]);

  const sortHand = (h) => [...(h || [])].sort((a, b) => a.id - b.id);
  
  const getProcessedHand = (currentHand) => {
    if (!currentHand || currentHand.length === 0) return [];
    let p = currentHand.map(c => ({ ...c, isCompleted: false }));
    const cnt = {}; p.forEach(c => { cnt[c.id] = (cnt[c.id] || 0) + 1; });
    p = p.map(c => cnt[c.id] >= 3 ? { ...c, isCompleted: true } : c);
    
    ['オレンジ', '赤', '青', '緑'].forEach(cat => {
      const catCards = p.filter(c => c.category === cat && !c.isCompleted);
      const uIds = [...new Set(catCards.map(c => c.id))];
      if (uIds.length >= 3) p = p.map(c => (c.category === cat && uIds.includes(c.id)) ? { ...c, isCompleted: true } : c);
    });
    return p;
  };

  const calculateScore = (finalHand, isWinner) => {
    let total = isWinner ? 40 : 0;
    let breakdown = [];
    if (isWinner) breakdown.push("勝利ボーナス: 40点");
    const processed = getProcessedHand(finalHand);
    const checkedIds = new Set();
    for (let i = 1; i <= 12; i++) {
      const same = processed.filter(c => c.id === i);
      if (same.length >= 3) { total += 30; breakdown.push(`${same[0].name}同種: 30点`); checkedIds.add(i); }
    }
    ['オレンジ', '赤', '青', '緑'].forEach(cat => {
      const catCards = processed.filter(c => c.category === cat && !checkedIds.has(c.id));
      const uIds = [...new Set(catCards.map(c => c.id))];
      if (uIds.length >= 3) { total += 15; breakdown.push(`${cat}セット: 15点`); }
    });
    return { total, breakdown };
  };

  const startAction = () => {
    const fullDeck = [];
    CARD_TYPES.forEach(type => {
      for(let i=0; i<5; i++) fullDeck.push({...type, instanceId: Math.random()});
    });
    fullDeck.sort(() => Math.random() - 0.5);

    if (gameMode === "cpu") {
      setHand(sortHand(fullDeck.splice(0, 8)));
      setCpuHands([fullDeck.splice(0, 8), fullDeck.splice(0, 8), fullDeck.splice(0, 8)]);
      setDeck(fullDeck); setSlots([null,null,null,null]);
      setGameStatus("playing"); setTurn(0); setHasDrawn(false); setGameLog("あなたの番です");
    } else {
      const updatedPlayers = { ...players };
      Object.keys(updatedPlayers).forEach(id => { updatedPlayers[id].hand = sortHand(fullDeck.splice(0, 8)); });
      update(ref(db, `rooms/${roomId}`), { status: "playing", deck: fullDeck, players: updatedPlayers, slots: [null,null,null,null], turn: 0, hasDrawn: false, log: "ゲーム開始！" });
    }
  };

  const joinGame = () => {
    if (!playerName) return alert("名前を入力してください");
    const playersRef = ref(db, `rooms/${roomId}/players`);
    const newPlayerRef = push(playersRef);
    setMyId(newPlayerRef.key);
    set(newPlayerRef, { name: playerName, joinedAt: serverTimestamp(), hand: [], score: 0 });
    onDisconnect(newPlayerRef).remove();
    setIsJoined(true);
  };

  const playerEntries = Object.entries(players).sort((a,b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const playerIds = playerEntries.map(e => e[0]);
  const myIndex = gameMode === "online" ? playerIds.indexOf(myId) : 0;
  const currentHand = gameMode === "online" ? (players[myId]?.hand || []) : hand;

  const drawAction = () => {
    if (turn !== myIndex || hasDrawn || gameStatus !== "playing") return;
    let newDeck = [...deck];
    let newSlots = [...slots];
    if (newDeck.length === 0) {
      newDeck = newSlots.filter(s => s !== null).sort(() => Math.random() - 0.5);
      newSlots = [null, null, null, null];
      setGameLog("山札を補充しました");
    }
    if (newDeck.length === 0) return alert("カードがありません");
    const picked = newDeck.pop();
    if (gameMode === "cpu") {
      setHand(sortHand([...hand, picked])); setDeck(newDeck); setSlots(newSlots); setHasDrawn(true);
    } else {
      update(ref(db, `rooms/${roomId}`), { deck: newDeck, slots: newSlots, [`players/${myId}/hand`]: sortHand([...currentHand, picked]), hasDrawn: true });
    }
  };

  const discardAction = (idx) => {
    if (turn !== myIndex || !hasDrawn || gameStatus !== "playing") return;
    const newHand = [...currentHand];
    const discarded = newHand.splice(idx, 1)[0];
    if (gameMode === "cpu") {
      const newSlots = [...slots]; newSlots[0] = discarded;
      const sortedHand = sortHand(newHand);
      setHand(sortedHand); setSlots(newSlots); setHasDrawn(false);
      if (getProcessedHand(sortedHand).filter(c => c.isCompleted).length === 9) {
        setGameStatus("finished"); setLastWinDetails(calculateScore(sortedHand, true)); setGameLog("あなたの上がり！");
      } else { setTurn(1); }
    } else {
      const nextTurn = (turn + 1) % playerIds.length;
      update(ref(db, `rooms/${roomId}`), { [`players/${myId}/hand`]: sortHand(newHand), [`slots/${myIndex}`]: discarded, turn: nextTurn, hasDrawn: false });
      if (getProcessedHand(newHand).filter(c => c.isCompleted).length === 9) {
        update(ref(db, `rooms/${roomId}`), { status: "finished", lastWinDetails: calculateScore(newHand, true), log: `${playerName}の上がり！` });
      }
    }
  };

  const pickFromSlotAction = (idx) => {
    if (turn !== myIndex || hasDrawn || !slots[idx] || gameStatus !== "playing") return;
    const picked = slots[idx];
    const newSlots = [...slots]; newSlots[idx] = null;
    if (gameMode === "cpu") {
      setHand(sortHand([...hand, picked])); setSlots(newSlots); setHasDrawn(true);
    } else {
      update(ref(db, `rooms/${roomId}`), { slots: newSlots, [`players/${myId}/hand`]: sortHand([...currentHand, picked]), hasDrawn: true });
    }
  };

  // CardDisplayの修正版：emoji-wrapperを追加
  const CardDisplay = ({ card, onClick, className }) => {
    if (!card) return null;
    return (
      <div className={`card ${className || ""}`} style={{ '--card-color': card.color }} onClick={onClick}>
        <div className="card-inner">
          <div className="card-category-tag" style={{backgroundColor: card.color}}>{card.category}</div>
          <div className="card-icon emoji-wrapper">{card.icon}</div>
          <div className="card-name">{card.name}</div>
        </div>
        {card.isCompleted && <div className="set-label">SET!</div>}
      </div>
    );
  };

  if (!gameMode) {
    return (
      <div className="game-container">
        <div className="start-screen">
          <h1 className="title">🍲 Hotpot Game</h1>
          <button onClick={() => setGameMode("cpu")} className="mode-button">CPUと対戦</button>
          <button onClick={() => setGameMode("online")} className="mode-button online">オンライン対戦</button>
        </div>
      </div>
    );
  }

  if (gameMode === "online" && !isJoined) {
    return (
      <div className="game-container">
        <div className="start-screen">
          <h2>オンライン対戦</h2>
          <input type="text" value={playerName} onChange={(e)=>setPlayerName(e.target.value)} className="name-input" placeholder="名前を入力" />
          <button onClick={joinGame} className="start-button">入室</button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-container">
      <div className="top-bar"><span>{gameMode === "online" ? `Room: ${roomId}` : "一人プレイ"}</span></div>
      {gameStatus === "waiting" ? (
        <div className="start-screen">
          <button onClick={startAction} className="start-button">ゲーム開始</button>
        </div>
      ) : (
        <div className="playing-field">
          <div className="table-row">
            <div className={`player-box ${(turn === (myIndex + 2) % 4) ? 'active' : ''}`}>
              <div className="p-name">{gameMode === "online" ? (players[playerIds[(myIndex+2)%4]]?.name || "---") : "CPU 2"}</div>
              <div className="slot-card" onClick={() => pickFromSlotAction((myIndex + 2) % 4)}><CardDisplay card={slots[(myIndex + 2) % 4]} /></div>
            </div>
          </div>
          <div className="table-row middle">
            <div className={`player-box side ${(turn === (myIndex + 1) % 4) ? 'active' : ''}`}>
              <div className="p-name">{gameMode === "online" ? (players[playerIds[(myIndex+1)%4]]?.name || "---") : "CPU 1"}</div>
              <div className="slot-card" onClick={() => pickFromSlotAction((myIndex + 1) % 4)}><CardDisplay card={slots[(myIndex + 1) % 4]} /></div>
            </div>
            <div className="center-deck">
              <div className={`deck-visual ${(turn === myIndex && !hasDrawn) ? 'can-draw' : ''}`} onClick={drawAction}>
                <div className="deck-label">山札</div><div className="deck-count">{deck.length}</div>
              </div>
            </div>
            <div className={`player-box side ${(turn === (myIndex + 3) % 4) ? 'active' : ''}`}>
              <div className="p-name">{gameMode === "online" ? (players[playerIds[(myIndex+3)%4]]?.name || "---") : "CPU 3"}</div>
              <div className="slot-card" onClick={() => pickFromSlotAction((myIndex + 3) % 4)}><CardDisplay card={slots[(myIndex + 3) % 4]} /></div>
            </div>
          </div>
          <div className="message-log">{gameLog}</div>
          <div className="table-row bottom">
            <div className="player-box my-area">
              <div className="slot-card my-slot" onClick={() => pickFromSlotAction(myIndex)}><CardDisplay card={slots[myIndex]} /></div>
              <div className="hand">
                {getProcessedHand(currentHand).map((c, i) => (
                  <CardDisplay key={i} card={c} className={`${(turn === myIndex && hasDrawn) ? 'discardable' : ''} ${c.isCompleted ? 'completed' : ''}`} onClick={() => discardAction(i)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {gameStatus === "finished" && (
        <div className="win-overlay">
          <div className="win-message">
            <h2>終局</h2><p>{gameLog}</p>
            <div className="score-breakdown">
              {lastWinDetails.breakdown?.map((item, i) => (<div key={i} className="score-item">{item}</div>))}
              <hr /><div className="score-total">合計: {lastWinDetails.total} 点</div>
            </div>
            <button onClick={startAction} className="start-button">もう一度</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;