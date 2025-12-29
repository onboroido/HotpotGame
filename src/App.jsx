import { useState, useEffect, useCallback } from 'react'
import './App.css'
import { db } from './firebase'; 
import { ref, onValue, set, update, push, onDisconnect } from "firebase/database";

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
  const [roomId, setRoomId] = useState(() => new URLSearchParams(window.location.search).get('room') || "");
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
  const [lastWinDetails, setLastWinDetails] = useState(null);
  const [hand, setHand] = useState([]); 
  const [totalScore, setTotalScore] = useState(0);

  const getInviteUrl = () => `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const sortHand = (h) => [...(h || [])].sort((a, b) => a.id - b.id);

  // --- 判定ロジック ---
  const getProcessedHand = (currentHand) => {
    if (!currentHand || currentHand.length === 0) return [];
    let p = currentHand.map(c => ({ ...c, isCompleted: false }));
    const counts = {};
    p.forEach(c => { counts[c.id] = (counts[c.id] || 0) + 1; });
    
    // 刻み（同じカード3枚）の判定
    p = p.map(c => counts[c.id] >= 3 ? { ...c, isCompleted: true } : c);
    
    // セット（同じカテゴリ3種類）の判定
    ['野菜', '肉類', '魚介', '葉物'].forEach(cat => {
      const catCards = p.filter(c => c.category === cat && !c.isCompleted);
      const uniqueIds = [...new Set(catCards.map(c => c.id))];
      if (uniqueIds.length >= 3) {
        const usedIds = uniqueIds.slice(0, 3);
        p = p.map(c => (c.category === cat && usedIds.includes(c.id) && !c.isCompleted) ? { ...c, isCompleted: true } : c);
      }
    });
    return p;
  };

  const checkWin = (currentHand) => {
    const processed = getProcessedHand(currentHand);
    return processed.filter(c => c.isCompleted).length >= 9;
  };

  const calculateScore = (finalHand, isWinner) => {
    let total = isWinner ? 40 : 0; // 上がりボーナス
    const processed = getProcessedHand(finalHand);
    const checkedIds = new Set();
    const idCount = {}; 
    processed.forEach(c => idCount[c.id] = (idCount[c.id] || 0) + 1);
    
    Object.keys(idCount).forEach(id => {
      if (idCount[id] >= 3) { total += 30; checkedIds.add(parseInt(id)); }
    });
    
    ['野菜', '肉類', '魚介', '葉物'].forEach(cat => {
      const catCards = processed.filter(c => c.category === cat && !checkedIds.has(c.id));
      const uIds = [...new Set(catCards.map(c => c.id))];
      if (uIds.length >= 3) total += 15;
    });
    return { total };
  };

  // 全員のスコアを計算して適用する関数
  const finalizeGameScores = (winnerId = null) => {
    const pIds = Object.keys(players);
    const updates = {};
    let myRoundScore = 0;

    pIds.forEach(id => {
      const isWinner = (id === winnerId);
      const playerHand = players[id].hand || [];
      const scoreData = calculateScore(playerHand, isWinner);
      
      updates[`players/${id}/score`] = (players[id].score || 0) + scoreData.total;
      if (id === myId) myRoundScore = scoreData.total;
    });

    updates.status = "finished";
    // 便宜上、最後に上がった人のスコア詳細をリザルト画面のメインに表示
    const winHand = winnerId ? players[winnerId].hand : [];
    updates.lastWinDetails = calculateScore(winHand, true); 
    
    update(ref(db, `rooms/${roomId}`), updates);
  };

  // --- CPU思考ロジック ---
  useEffect(() => {
    if (gameStatus !== "playing") return;

    const runCpuTurn = async () => {
      if (gameMode === "cpu" && turn !== 0) {
        setGameLog(`CPU ${turn} が考え中...`);
        if (!hasDrawn) {
          await new Promise(r => setTimeout(r, 1000));
          const newDeck = [...deck];
          const picked = newDeck.pop();
          setDeck(newDeck);
          setHasDrawn(true);
        } else {
          await new Promise(r => setTimeout(r, 1000));
          const ns = [...slots];
          const cpuDiscard = deck[deck.length - 1] || CARD_TYPES[0]; 
          ns[turn] = cpuDiscard; 
          setSlots(ns);
          setHasDrawn(false);
          setTurn((turn + 1) % 4);
        }
      }

      if (gameMode === "online") {
        const pIds = Object.keys(players);
        const currentPlayerId = pIds[turn];
        const isHost = myId === pIds[0];
        if (!isHost || !players[currentPlayerId]?.isCpu) return;

        const roomRef = ref(db, `rooms/${roomId}`);
        if (!hasDrawn) {
          await new Promise(r => setTimeout(r, 1200));
          const newDeck = [...deck];
          if (newDeck.length === 0) return;
          const picked = newDeck.pop();
          const cpuHand = sortHand([...(players[currentPlayerId].hand || []), picked]);
          
          if (checkWin(cpuHand)) {
            // CPUが上がった場合、ホストが全員のスコアを計算
            const roundUpdates = { deck: newDeck, [`players/${currentPlayerId}/hand`]: cpuHand };
            update(roomRef, roundUpdates).then(() => {
              finalizeGameScores(currentPlayerId);
            });
            return;
          }
          
          update(roomRef, { deck: newDeck, [`players/${currentPlayerId}/hand`]: cpuHand, hasDrawn: true });
        } else {
          await new Promise(r => setTimeout(r, 1200));
          const cpuHand = [...(players[currentPlayerId].hand || [])];
          const discardIdx = Math.floor(Math.random() * cpuHand.length);
          const discarded = cpuHand.splice(discardIdx, 1)[0];
          update(roomRef, {
            [`players/${currentPlayerId}/hand`]: sortHand(cpuHand),
            [`slots/${turn}`]: discarded,
            turn: (turn + 1) % 4,
            hasDrawn: false
          });
        }
      }
    };
    runCpuTurn();
  }, [turn, hasDrawn, gameStatus, gameMode, deck, players, roomId, myId, slots]);

  // --- ゲーム管理 ---
  const startAction = useCallback(async (resetGame = false) => {
    const fullDeck = [];
    CARD_TYPES.forEach(type => { for(let i=0; i<5; i++) fullDeck.push({...type, instanceId: Math.random()}); });
    fullDeck.sort(() => Math.random() - 0.5);
    const nextRound = resetGame ? 1 : round + 1;

    if (gameMode === "online") {
      const roomRef = ref(db, `rooms/${roomId}`);
      const updates = {};
      const currentPIds = Object.keys(players);
      const finalPlayers = { ...players };
      for (let i = currentPIds.length; i < 4; i++) {
        const cpuId = `cpu_${i}`;
        if (!finalPlayers[cpuId]) {
          finalPlayers[cpuId] = { name: `CPU ${i}`, hand: [], score: 0, isCpu: true };
        }
      }
      Object.keys(finalPlayers).forEach(id => {
        updates[`players/${id}/hand`] = sortHand(fullDeck.splice(0, 8));
        if (resetGame) updates[`players/${id}/score`] = 0;
        updates[`players/${id}/isCpu`] = !!finalPlayers[id].isCpu;
        updates[`players/${id}/name`] = finalPlayers[id].name;
      });
      updates.round = nextRound;
      updates.status = "playing";
      updates.deck = fullDeck;
      updates.slots = [null, null, null, null];
      updates.turn = 0;
      updates.hasDrawn = false;
      updates.log = `第${nextRound}ラウンド開始！`;
      updates.lastWinDetails = null;
      await update(roomRef, updates);
    } else {
      if (resetGame) setTotalScore(0);
      setRound(nextRound);
      setHand(sortHand(fullDeck.splice(0, 8)));
      setDeck(fullDeck);
      setSlots([null, null, null, null]);
      setGameStatus("playing");
      setTurn(0);
      setHasDrawn(false);
      setGameLog(`第${nextRound}ラウンド開始！`);
      setLastWinDetails(null);
    }
  }, [gameMode, round, players, roomId]);

  useEffect(() => {
    if (gameMode !== "online" || !roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    return onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      setPlayers(data.players || {});
      setGameStatus(data.status || "waiting");
      setDeck(data.deck || []);
      setSlots(data.slots || [null, null, null, null]);
      setTurn(data.turn || 0);
      setRound(data.round || 1);
      setGameLog(data.log || "");
      setHasDrawn(data.hasDrawn || false);
      if (data.lastWinDetails) setLastWinDetails(data.lastWinDetails);
    });
  }, [gameMode, roomId]);

  // --- プレイヤーアクション ---
  const drawAction = () => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || hasDrawn || gameStatus !== "playing") return;

    const newDeck = [...deck];
    const picked = newDeck.pop();
    const curH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = sortHand([...(curH || []), picked]);

    if (checkWin(newHand)) {
      if (gameMode === "online") {
        update(ref(db, `rooms/${roomId}`), { [`players/${myId}/hand`]: newHand }).then(() => {
          finalizeGameScores(myId);
        });
      } else {
        setHand(newHand);
        const sd = calculateScore(newHand, true);
        setTotalScore(s => s + sd.total);
        setGameStatus("finished");
        setLastWinDetails(sd);
      }
      return;
    }

    if (gameMode === "online") {
      update(ref(db, `rooms/${roomId}`), { deck: newDeck, [`players/${myId}/hand`]: newHand, hasDrawn: true });
    } else {
      setHand(newHand); setDeck(newDeck); setHasDrawn(true);
    }
  };

  const discardAction = (idx) => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || !hasDrawn) return;

    const curH = gameMode === "online" ? (players[myId]?.hand || []) : hand;
    const newHand = [...curH];
    const discarded = newHand.splice(idx, 1)[0];

    if (gameMode === "online") {
      update(ref(db, `rooms/${roomId}`), {
        [`players/${myId}/hand`]: sortHand(newHand),
        [`slots/${mIdx}`]: discarded,
        turn: (turn + 1) % 4,
        hasDrawn: false
      });
    } else {
      const ns = [...slots]; ns[0] = discarded;
      setHand(sortHand(newHand)); setSlots(ns); setHasDrawn(false); setTurn(1);
    }
  };

  const pickFromSlotAction = (idx) => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || hasDrawn || !slots[idx]) return;

    const picked = slots[idx];
    const ns = [...slots]; ns[idx] = null;
    const curH = gameMode === "online" ? (players[myId]?.hand || []) : hand;
    const newHand = sortHand([...curH, picked]);

    if (checkWin(newHand)) {
      if (gameMode === "online") {
        update(ref(db, `rooms/${roomId}`), { 
          slots: ns,
          [`players/${myId}/hand`]: newHand 
        }).then(() => {
          finalizeGameScores(myId);
        });
      } else {
        setHand(newHand); setSlots(ns); 
        const sd = calculateScore(newHand, true);
        setTotalScore(s => s + sd.total); setGameStatus("finished"); setLastWinDetails(sd);
      }
      return;
    }

    if (gameMode === "online") {
      update(ref(db, `rooms/${roomId}`), { slots: ns, [`players/${myId}/hand`]: newHand, hasDrawn: true });
    } else {
      setHand(newHand); setSlots(ns); setHasDrawn(true);
    }
  };

  const CardDisplay = ({ card, onClick, className }) => (
    card ? (
      <div className={`card ${className || ""}`} style={{ '--card-color': card.color }} onClick={onClick}>
        <div className="card-inner">
          <div className="card-category-tag" style={{backgroundColor: card.color}}>{card.category}</div>
          <div className="card-icon">{card.icon}</div>
          <div className="card-name">{card.name}</div>
          {card.isCompleted && <div className="set-badge">SET</div>}
        </div>
      </div>
    ) : null
  );

  if (!gameMode) return (
    <div className="game-container menu-bg">
      <div className="start-screen main-menu">
        <h1 className="title-large">🍲 Hotpot Game</h1>
        <div className="menu-buttons">
          <button onClick={() => { setGameMode("cpu"); setGameStatus("playing"); }} className="mega-button">一人で練習 (CPU戦)</button>
          <button onClick={() => {
            const currentRoom = new URLSearchParams(window.location.search).get('room');
            const targetRoom = currentRoom || Math.random().toString(36).substring(2,7);
            setRoomId(targetRoom);
            setGameMode("online");
            if(!currentRoom) window.history.pushState({}, '', `?room=${targetRoom}`);
          }} className="mega-button">オンライン対戦</button>
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
          try {
            const pRef = push(ref(db, `rooms/${roomId}/players`));
            setMyId(pRef.key);
            await set(pRef, { name: playerName, hand: [], score: 0 });
            onDisconnect(pRef).remove();
            setIsJoined(true);
          } catch(e) { alert("入室失敗"); }
        }} className="mega-button">参加する</button>
      </div>
    </div>
  );

  if (gameMode === "cpu" && gameStatus === "playing" && hand.length === 0) startAction(true);

  const pIds = Object.keys(players);
  const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
  const curHand = gameMode === "online" ? (players[myId]?.hand || []) : hand;
  const currentRank = Object.keys(players).map(id => ({ name: players[id].name, score: players[id].score || 0, isMe: id === myId })).sort((a,b)=>b.score-a.score);
  
  // 自分が今ラウンドで得たスコアを表示用
  const myRoundScore = calculateScore(curHand, checkWin(curHand)).total;

  return (
    <div className="game-container">
      <div className="round-badge">{round}/3</div>
      {gameMode === "online" && gameStatus === "waiting" ? (
        <div className="start-screen centered">
          <div className="waiting-card">
            <h2>待機中 ({pIds.length}/4)</h2>
            <div className="p-list">{pIds.map(id => <div key={id} className="p-list-item">{players[id].name}</div>)}</div>
            <div className="invite-box">
              <p>招待URL</p>
              <input type="text" readOnly value={getInviteUrl()} className="url-input" />
              <button onClick={() => {navigator.clipboard.writeText(getInviteUrl()); alert("コピーしました！")}}>コピー</button>
            </div>
            <button onClick={() => startAction(true)} className="mega-button">ゲーム開始 (CPU補充)</button>
          </div>
        </div>
      ) : (
        <div className="playing-wrapper playing-bg">
          <div className="main-area">
            <div className="row top"><div className={`p-box ${(turn === (mIdx+2)%4) ? 'active' : ''}`}>{gameMode === "online" ? (players[pIds[(mIdx+2)%4]]?.name || "CPU 2") : "CPU 2"}</div></div>
            <div className="row middle">
              <div className="side-container left"><div className={`p-box ${(turn === (mIdx+1)%4) ? 'active' : ''}`}>{gameMode === "online" ? (players[pIds[(mIdx+1)%4]]?.name || "CPU 1") : "CPU 1"}</div></div>
              <div className="board-center">
                <div className="slots-grid">
                  <div className="slot t" onClick={()=>pickFromSlotAction((mIdx+2)%4)}><CardDisplay card={slots[(mIdx+2)%4]}/></div>
                  <div className="slot l" onClick={()=>pickFromSlotAction((mIdx+1)%4)}><CardDisplay card={slots[(mIdx+1)%4]}/></div>
                  <div className={`deck ${(!hasDrawn && turn===mIdx) ? 'can-draw' : ''}`} onClick={drawAction}>山札</div>
                  <div className="slot r" onClick={()=>pickFromSlotAction((mIdx+3)%4)}><CardDisplay card={slots[(mIdx+3)%4]}/></div>
                  <div className="slot b" onClick={()=>pickFromSlotAction(mIdx)}><CardDisplay card={slots[mIdx]}/></div>
                </div>
              </div>
              <div className="side-container right"><div className={`p-box ${(turn === (mIdx+3)%4) ? 'active' : ''}`}>{gameMode === "online" ? (players[pIds[(mIdx+3)%4]]?.name || "CPU 3") : "CPU 3"}</div></div>
            </div>
            <div className="row bottom">
              <div className="log">{gameLog}</div>
              <div className={`hand ${turn === mIdx ? 'my-turn' : ''}`}>
                {getProcessedHand(curHand).map((c, i) => <CardDisplay key={i} card={c} className={hasDrawn && turn===mIdx ? 'active' : ''} onClick={()=>discardAction(i)}/>)}
              </div>
            </div>
          </div>
          <div className="rank-panel">
            <div className="rank-title">RANKING</div>
            <div className="rank-list">
              {(gameMode === "online" ? currentRank : [
                { name: "あなた", score: totalScore, isMe: true },
                { name: "CPU 1", score: 0 }, { name: "CPU 2", score: 0 }, { name: "CPU 3", score: 0 }
              ].sort((a,b)=>b.score-a.score)).map((r, i) => (
                <div key={i} className={`rank-item ${r.isMe?'me':''}`}><span>{i+1}. {r.name}</span><span>{r.score}pt</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
      {gameStatus === "finished" && (
        <div className="win-overlay">
          <div className="win-card">
            <h2 className="win-title">{checkWin(curHand) ? "いただきます！" : "ごちそうさま！"}</h2>
            <p className="round-score-label">このラウンドの獲得スコア</p>
            <div className="win-score-display">
              <span className="win-score-val">+{myRoundScore}</span>
              <span className="win-score-unit">pt</span>
            </div>
            <button onClick={() => startAction(false)} className="mega-button">次のラウンドへ</button>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;