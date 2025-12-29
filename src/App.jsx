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
  const [gameLog, setGameLog] = useState("対戦相手を待っています...");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [lastWinDetails, setLastWinDetails] = useState({ total: 0 });
  const [hand, setHand] = useState([]); 
  const [totalScore, setTotalScore] = useState(0);

  const getInviteUrl = () => `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const sortHand = (h) => [...(h || [])].sort((a, b) => a.id - b.id);

  const getProcessedHand = (currentHand) => {
    if (!currentHand || currentHand.length === 0) return [];
    let p = currentHand.map(c => ({ ...c, isCompleted: false }));
    const counts = {};
    p.forEach(c => { counts[c.id] = (counts[c.id] || 0) + 1; });
    p = p.map(c => counts[c.id] >= 3 ? { ...c, isCompleted: true } : c);
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

  const checkWin = (currentHand) => getProcessedHand(currentHand).filter(c => c.isCompleted).length >= 9;

  const calculateScore = (finalHand, isWinner) => {
    let total = isWinner ? 40 : 0;
    const processed = getProcessedHand(finalHand);
    const checkedIds = new Set();
    const idCount = {}; processed.forEach(c => idCount[c.id] = (idCount[c.id] || 0) + 1);
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

  const getRanking = () => {
    if (gameMode === "online") {
      return Object.keys(players).map(id => ({
        name: players[id].name,
        score: players[id].score || 0,
        isMe: id === myId
      })).sort((a, b) => b.score - a.score);
    }
    return [
      { name: "あなた", score: totalScore, isMe: true },
      { name: "CPU 1", score: 0, isMe: false },
      { name: "CPU 2", score: 0, isMe: false },
      { name: "CPU 3", score: 0, isMe: false }
    ].sort((a, b) => b.score - a.score);
  };

  const startAction = useCallback((resetGame = false) => {
    const fullDeck = [];
    CARD_TYPES.forEach(type => { for(let i=0; i<5; i++) fullDeck.push({...type, instanceId: Math.random()}); });
    fullDeck.sort(() => Math.random() - 0.5);
    const nextRound = resetGame ? 1 : round + 1;

    if (resetGame) {
        setTotalScore(0);
        setLastWinDetails({ total: 0 });
    }

    if (gameMode === "cpu") {
      setRound(nextRound);
      setHand(sortHand(fullDeck.splice(0, 8)));
      setDeck(fullDeck);
      setSlots([null, null, null, null]);
      setGameStatus("playing");
      setTurn(0);
      setHasDrawn(false);
      setGameLog(`第${nextRound}ラウンド開始！`);
    } else if (gameMode === "online") {
      const pIds = Object.keys(players);
      const updates = {};
      pIds.forEach(id => { 
        updates[`players/${id}/hand`] = sortHand(fullDeck.splice(0, 8)); 
        if (resetGame) updates[`players/${id}/score`] = 0;
      });
      updates['round'] = nextRound;
      updates['status'] = "playing";
      updates['deck'] = fullDeck;
      updates['slots'] = [null, null, null, null];
      updates['turn'] = 0;
      updates['hasDrawn'] = false;
      updates['lastWinDetails'] = { total: 0 };
      updates['log'] = `第${nextRound}ラウンド開始！`;
      update(ref(db, `rooms/${roomId}`), updates);
    }
  }, [gameMode, round, players, roomId, totalScore]);

  useEffect(() => {
    if (gameMode !== "online" || !roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      setPlayers(data.players || {});
      setGameStatus(data.status || "waiting");
      setDeck(data.deck || []);
      setSlots(data.slots || [null, null, null, null]);
      setTurn(data.turn || 0);
      setRound(data.round || 1);
      setGameLog(data.log || "対戦相手を待っています...");
      setHasDrawn(data.hasDrawn || false);
      if (data.lastWinDetails) setLastWinDetails(data.lastWinDetails);
    });
    return () => unsubscribe();
  }, [gameMode, roomId]);

  const drawAction = () => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || hasDrawn || gameStatus !== "playing") return;
    const newDeck = [...deck];
    const picked = newDeck.pop();
    const curH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = sortHand([...(curH || []), picked]);
    if (gameMode === "cpu") {
      setHand(newHand); setDeck(newDeck); setHasDrawn(true);
      if (checkWin(newHand)) finishRound(newHand, true, "あなた");
    } else {
      update(ref(db, `rooms/${roomId}`), { deck: newDeck, [`players/${myId}/hand`]: newHand, hasDrawn: true });
      if (checkWin(newHand)) finishRound(newHand, true, playerName);
    }
  };

  const discardAction = (idx) => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || !hasDrawn) return;
    const curH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = [...(curH || [])];
    const discarded = newHand.splice(idx, 1)[0];
    if (gameMode === "cpu") {
      const ns = [...slots]; ns[0] = discarded;
      setHand(sortHand(newHand)); setSlots(ns); setHasDrawn(false); setTurn(1);
    } else {
      update(ref(db, `rooms/${roomId}`), { [`players/${myId}/hand`]: sortHand(newHand), [`slots/${mIdx}`]: discarded, turn: (turn + 1) % pIds.length, hasDrawn: false });
    }
  };

  const pickFromSlotAction = (idx) => {
    const pIds = Object.keys(players);
    const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
    if (turn !== mIdx || hasDrawn || !slots[idx]) return;
    const picked = slots[idx];
    const ns = [...slots]; ns[idx] = null;
    const curH = gameMode === "online" ? players[myId].hand : hand;
    const newHand = sortHand([...(curH || []), picked]);
    if (gameMode === "cpu") {
      setHand(newHand); setSlots(ns); setHasDrawn(true);
      if (checkWin(newHand)) finishRound(newHand, true, "あなた");
    } else {
      update(ref(db, `rooms/${roomId}`), { slots: ns, [`players/${myId}/hand`]: newHand, hasDrawn: true });
    }
  };

  const finishRound = (winH, isMe, wName) => {
    const sd = calculateScore(winH, isMe);
    if (gameMode === "cpu") {
      if (isMe) setTotalScore(s => s + sd.total);
      setGameStatus("finished"); setLastWinDetails(sd); setGameLog(`${wName}の勝利！`);
    } else {
      const updates = { status: "finished", lastWinDetails: sd, log: `${wName}の勝利！` };
      if (isMe) updates[`players/${myId}/score`] = (players[myId]?.score || 0) + sd.total;
      update(ref(db, `rooms/${roomId}`), updates);
    }
  };

  const CardDisplay = ({ card, onClick, className }) => (
    card ? (
      <div className={`card ${className || ""}`} style={{ '--card-color': card.color }} onClick={onClick}>
        <div className="card-inner">
          <div className="card-category-tag" style={{backgroundColor: card.color}}>{card.category}</div>
          <div className="card-icon">{card.icon}</div>
          <div className="card-name">{card.name}</div>
        </div>
      </div>
    ) : null
  );

  if (!gameMode) return (
    <div className="game-container menu-bg">
      <div className="start-screen main-menu">
        <h1 className="title-large">🍲 Hotpot Game</h1>
        <div className="menu-buttons">
          <button onClick={() => { setGameMode("cpu"); setGameStatus("playing"); }} className="mega-button">CPUと対戦</button>
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

  if (gameMode === "cpu" && gameStatus === "playing" && hand.length === 0) {
    startAction(true);
  }

  /* --- ここが修正された入室セクション --- */
  if (gameMode === "online" && !isJoined) return (
    <div className="game-container">
      <div className="start-screen">
        <h2 className="section-title">プレイヤー登録</h2>
        <p className="room-id-display">Room: {roomId}</p>
        <input 
          type="text" 
          value={playerName} 
          onChange={(e) => setPlayerName(e.target.value)} 
          className="name-input-large" 
          placeholder="名前を入力" 
        />
        <button 
          onClick={async () => {
            if (!playerName.trim()) return;
            try {
              // 1. pushして一意のIDを取得
              const pRef = push(ref(db, `rooms/${roomId}/players`));
              setMyId(pRef.key);
              
              // 2. setで確実に書き込み、完了を待機
              await set(pRef, { 
                name: playerName, 
                hand: [], 
                score: 0 
              });
              
              // 3. ブラウザを閉じた時に自動削除
              onDisconnect(pRef).remove();
              
              // 4. 成功したらフラグを立てる
              setIsJoined(true);
            } catch (err) {
              console.error("Firebase書き込みエラー:", err);
              alert("入室に失敗しました。接続を確認してください。");
            }
          }} 
          className="mega-button"
        >
          参加する
        </button>
      </div>
    </div>
  );
  /* --- 修正セクション終了 --- */

  const pIds = Object.keys(players);
  const mIdx = gameMode === "online" ? pIds.indexOf(myId) : 0;
  const curHand = gameMode === "online" ? (players[myId]?.hand || []) : hand;

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
            {pIds.length >= 1 && <button onClick={() => startAction(true)} className="mega-button">全員揃ったら開始</button>}
          </div>
        </div>
      ) : (
        <div className="playing-wrapper">
          <div className="main-area">
            <div className="row top"><div className={`p-box ${(turn === (mIdx+2)%4) ? 'active' : ''}`}>{gameMode === "online" ? (players[pIds[(mIdx+2)%4]]?.name || "P3") : "CPU 2"}</div></div>
            <div className="row middle">
              <div className="side-container left"><div className={`p-box ${(turn === (mIdx+1)%4) ? 'active' : ''}`}>{gameMode === "online" ? (players[pIds[(mIdx+1)%4]]?.name || "P2") : "CPU 1"}</div></div>
              <div className="board-center">
                <div className="slots-grid">
                  <div className="slot t" onClick={()=>pickFromSlotAction((mIdx+2)%4)}><CardDisplay card={slots[(mIdx+2)%4]}/></div>
                  <div className="slot l" onClick={()=>pickFromSlotAction((mIdx+1)%4)}><CardDisplay card={slots[(mIdx+1)%4]}/></div>
                  <div className={`deck ${(!hasDrawn && turn===mIdx) ? 'can-draw' : ''}`} onClick={drawAction}>山札</div>
                  <div className="slot r" onClick={()=>pickFromSlotAction((mIdx+3)%4)}><CardDisplay card={slots[(mIdx+3)%4]}/></div>
                  <div className="slot b" onClick={()=>pickFromSlotAction(mIdx)}><CardDisplay card={slots[mIdx]}/></div>
                </div>
              </div>
              <div className="side-container right"><div className={`p-box ${(turn === (mIdx+3)%4) ? 'active' : ''}`}>{gameMode === "online" ? (players[pIds[(mIdx+3)%4]]?.name || "P4") : "CPU 3"}</div></div>
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
            <div className="rank-list">{getRanking().map((r, i) => <div key={i} className={`rank-item ${r.isMe?'me':''}`}><span>{i+1}. {r.name}</span><span>{r.score}pt</span></div>)}</div>
          </div>
        </div>
      )}

      {gameStatus === "finished" && (
        <div className="win-overlay"><div className="win-card"><h2>いただきます！</h2><div className="score">{lastWinDetails.total}pt</div><button onClick={() => startAction(false)} className="mega-button">{round < 3 ? "次のラウンドへ" : "もう一杯！"}</button></div></div>
      )}
    </div>
  );
}
export default App;