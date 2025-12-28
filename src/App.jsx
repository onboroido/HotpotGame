import { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'; 
import { ref, onValue, set, update, push, onDisconnect, serverTimestamp } from "firebase/database";

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
  { id: 11, name: 'ネギ', category: '緑', color: '#27ae60', icon: '🎋' },
  { id: 12, name: 'ニラ', category: '緑', color: '#27ae60', icon: '🌿' },
];

function App() {
  const [gameMode, setGameMode] = useState(null);
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('room'));
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

  useEffect(() => {
    if (gameMode !== "online") return;
    let currentRoomId = roomId || Math.random().toString(36).substring(2, 7);
    if (!roomId) {
      setRoomId(currentRoomId);
      window.history.pushState({}, '', `?room=${currentRoomId}`);
    }
    const roomRef = ref(db, `rooms/${currentRoomId}`);
    return onValue(roomRef, (snapshot) => {
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
  }, [gameMode]);

  const sortHand = (h) => [...(h || [])].sort((a, b) => a.id - b.id);

  // セット判定ロジック
  const getProcessedHand = (currentHand) => {
    if (!currentHand || currentHand.length === 0) return [];
    let p = currentHand.map(c => ({ ...c, isCompleted: false }));
    const cnt = {}; p.forEach(c => { cnt[c.id] = (cnt[c.id] || 0) + 1; });
    
    // 1. 同種3枚セットの判定
    p = p.map(c => cnt[c.id] >= 3 ? { ...c, isCompleted: true } : c);
    
    // 2. 同カテゴリー3種類セットの判定（まだセットになっていないカードから選ぶ）
    ['オレンジ', '赤', '青', '緑'].forEach(cat => {
      const catCards = p.filter(c => c.category === cat && !c.isCompleted);
      const uniqueIds = [...new Set(catCards.map(c => c.id))];
      if (uniqueIds.length >= 3) {
        const usedIds = uniqueIds.slice(0, 3);
        p = p.map(c => (c.category === cat && usedIds.includes(c.id) && !c.isCompleted) ? { ...c, isCompleted: true } : c);
      }
    });
    return p;
  };

  const calculateScore = (finalHand, isWinner) => {
    let total = isWinner ? 40 : 0;
    let breakdown = isWinner ? ["勝利ボーナス: 40点"] : [];
    const processed = getProcessedHand(finalHand);
    const completedCount = processed.filter(c => c.isCompleted).length;
    
    // 同種セットの加点
    const checkedIds = new Set();
    const idCount = {}; processed.forEach(c => idCount[c.id] = (idCount[c.id] || 0) + 1);
    Object.keys(idCount).forEach(id => {
      if (idCount[id] >= 3) {
        total += 30;
        const name = CARD_TYPES.find(t => t.id === parseInt(id)).name;
        breakdown.push(`${name}同種セット: 30点`);
        checkedIds.add(parseInt(id));
      }
    });

    // カテゴリーセットの加点
    ['オレンジ', '赤', '青', '緑'].forEach(cat => {
      const catCards = processed.filter(c => c.category === cat && !checkedIds.has(c.id));
      const uIds = [...new Set(catCards.map(c => c.id))];
      if (uIds.length >= 3) {
        total += 15;
        breakdown.push(`${cat}カテゴリーセット: 15点`);
      }
    });

    return { total, breakdown };
  };

  const checkWin = (currentHand) => {
    const processed = getProcessedHand(currentHand);
    return processed.filter(c => c.isCompleted).length >= 9;
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

  const drawAction = () => {
    const myIndex = gameMode === "online" ? Object.keys(players).indexOf(myId) : 0;
    if (turn !== myIndex || hasDrawn || gameStatus !== "playing") return;
    
    let newDeck = [...deck];
    if (newDeck.length === 0) return alert("山札がなくなりました");
    
    const picked = newDeck.pop();
    const newHand = sortHand([...(gameMode === "online" ? players[myId].hand : hand), picked]);

    if (gameMode === "cpu") {
      setHand(newHand); setDeck(newDeck); setHasDrawn(true);
      if (checkWin(newHand)) {
        setGameStatus("finished"); setLastWinDetails(calculateScore(newHand, true)); setGameLog("ツモ上がり！");
      }
    } else {
      update(ref(db, `rooms/${roomId}`), { 
        deck: newDeck, 
        [`players/${myId}/hand`]: newHand, 
        hasDrawn: true 
      });
      if (checkWin(newHand)) {
        update(ref(db, `rooms/${roomId}`), { status: "finished", lastWinDetails: calculateScore(newHand, true), log: `${playerName}の上がり！` });
      }
    }
  };

  const discardAction = (idx) => {
    const myIndex = gameMode === "online" ? Object.keys(players).indexOf(myId) : 0;
    if (turn !== myIndex || !hasDrawn || gameStatus !== "playing") return;
    
    const currentH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = [...currentH];
    const discarded = newHand.splice(idx, 1)[0];
    
    if (gameMode === "cpu") {
      const newSlots = [...slots]; newSlots[0] = discarded;
      setHand(sortHand(newHand)); setSlots(newSlots); setHasDrawn(false); setTurn(1);
    } else {
      const nextTurn = (turn + 1) % Object.keys(players).length;
      update(ref(db, `rooms/${roomId}`), { 
        [`players/${myId}/hand`]: sortHand(newHand), 
        [`slots/${myIndex}`]: discarded, 
        turn: nextTurn, 
        hasDrawn: false 
      });
    }
  };

  const pickFromSlotAction = (idx) => {
    const myIndex = gameMode === "online" ? Object.keys(players).indexOf(myId) : 0;
    if (turn !== myIndex || hasDrawn || !slots[idx] || gameStatus !== "playing") return;
    
    const picked = slots[idx];
    const newSlots = [...slots]; newSlots[idx] = null;
    const newHand = sortHand([...(gameMode === "online" ? players[myId].hand : hand), picked]);

    if (gameMode === "cpu") {
      setHand(newHand); setSlots(newSlots); setHasDrawn(true);
      if (checkWin(newHand)) {
        setGameStatus("finished"); setLastWinDetails(calculateScore(newHand, true)); setGameLog("ロン上がり！");
      }
    } else {
      update(ref(db, `rooms/${roomId}`), { 
        slots: newSlots, 
        [`players/${myId}/hand`]: newHand, 
        hasDrawn: true 
      });
      if (checkWin(newHand)) {
        update(ref(db, `rooms/${roomId}`), { status: "finished", lastWinDetails: calculateScore(newHand, true), log: `${playerName}の上がり！` });
      }
    }
  };

  const CardDisplay = ({ card, onClick, className }) => {
    if (!card) return <div className="card-empty"></div>;
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

  // オンライン入室画面
  if (gameMode === "online" && !isJoined) {
    return (
      <div className="game-container">
        <div className="start-screen">
          <h2>オンライン対戦</h2>
          <input type="text" value={playerName} onChange={(e)=>setPlayerName(e.target.value)} className="name-input" placeholder="名前を入力" />
          <button onClick={() => {
            if (!playerName) return alert("名前を入力してください");
            const playersRef = ref(db, `rooms/${roomId}/players`);
            const newPlayerRef = push(playersRef);
            setMyId(newPlayerRef.key);
            set(newPlayerRef, { name: playerName, joinedAt: serverTimestamp(), hand: [], score: 0 });
            onDisconnect(newPlayerRef).remove();
            setIsJoined(true);
          }} className="start-button">入室する</button>
        </div>
      </div>
    );
  }

  const playerIds = Object.keys(players);
  const myIndex = gameMode === "online" ? playerIds.indexOf(myId) : 0;
  const currentHand = gameMode === "online" ? (players[myId]?.hand || []) : hand;

  return (
    <div className="game-container">
      <div className="top-bar"><span>{gameMode === "online" ? `Room: ${roomId}` : "一人プレイ"}</span></div>
      
      {gameStatus === "waiting" ? (
        <div className="start-screen">
          {gameMode === "online" && (
            <div className="invite-box">
              <h3>参加待ち... ({playerIds.length}/4)</h3>
              <div className="player-list-mini">
                {playerIds.map(id => <span key={id} className="mini-name-tag">● {players[id].name}</span>)}
              </div>
              <button onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                alert("URLをコピーしました");
              }} className="copy-button">招待URLをコピー</button>
            </div>
          )}
          <button onClick={startAction} className="start-button">ゲーム開始</button>
        </div>
      ) : (
        <div className="playing-field">
          {/* 上プレイヤー */}
          <div className="table-row">
            <div className={`player-box ${(turn === (myIndex + 2) % 4) ? 'active' : ''}`}>
              <div className="p-name">{gameMode === "online" ? (players[playerIds[(myIndex+2)%4]]?.name || "CPU") : "CPU 2"}</div>
              <div className="slot-card" onClick={() => pickFromSlotAction((myIndex + 2) % 4)}>
                <CardDisplay card={slots[(myIndex + 2) % 4]} />
              </div>
            </div>
          </div>

          {/* 中央（左・山札・右） */}
          <div className="table-row middle">
            <div className={`player-box side ${(turn === (myIndex + 1) % 4) ? 'active' : ''}`}>
              <div className="p-name">{gameMode === "online" ? (players[playerIds[(myIndex+1)%4]]?.name || "CPU") : "CPU 1"}</div>
              <div className="slot-card" onClick={() => pickFromSlotAction((myIndex + 1) % 4)}>
                <CardDisplay card={slots[(myIndex + 1) % 4]} />
              </div>
            </div>

            <div className="center-deck">
              <div className={`deck-visual ${(turn === myIndex && !hasDrawn) ? 'can-draw' : ''}`} onClick={drawAction}>
                <div className="deck-label">山札</div>
                <div className="deck-count">{deck.length}</div>
              </div>
            </div>

            <div className={`player-box side ${(turn === (myIndex + 3) % 4) ? 'active' : ''}`}>
              <div className="p-name">{gameMode === "online" ? (players[playerIds[(myIndex+3)%4]]?.name || "CPU") : "CPU 3"}</div>
              <div className="slot-card" onClick={() => pickFromSlotAction((myIndex + 3) % 4)}>
                <CardDisplay card={slots[(myIndex + 3) % 4]} />
              </div>
            </div>
          </div>

          <div className="message-log">{gameLog}</div>

          {/* 自分 */}
          <div className="table-row bottom">
            <div className={`player-box my-area ${turn === myIndex ? 'active' : ''}`}>
              <div className="my-layout">
                <div className="slot-card my-slot" onClick={() => pickFromSlotAction(myIndex)}>
                  <CardDisplay card={slots[myIndex]} />
                </div>
                <div className="hand">
                  {getProcessedHand(currentHand).map((c, i) => (
                    <CardDisplay 
                      key={i} 
                      card={c} 
                      className={`${(turn === myIndex && hasDrawn) ? 'discardable' : ''} ${c.isCompleted ? 'completed' : ''}`} 
                      onClick={() => discardAction(i)} 
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameStatus === "finished" && (
        <div className="win-overlay">
          <div className="win-message">
            <h2>対局終了</h2>
            <div className="score-total">{lastWinDetails.total} 点</div>
            <div className="score-breakdown">
              {lastWinDetails.breakdown?.map((text, i) => <div key={i} className="score-item">{text}</div>)}
            </div>
            <button onClick={startAction} className="start-button">もう一度遊ぶ</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;