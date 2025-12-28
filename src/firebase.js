// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
   apiKey: "AIzaSyDT7LEOVSdGkR19TSAQXfXqrOOOf-LXGYk",
  authDomain: "hot-pot-7ff3c.firebaseapp.com",
  databaseURL: "https://hot-pot-7ff3c-default-rtdb.firebaseio.com",
  projectId: "hot-pot-7ff3c",
  storageBucket: "hot-pot-7ff3c.firebasestorage.app",
  messagingSenderId: "569542890636",
  appId: "1:569542890636:web:acff659398ce521b7317a9",
  measurementId: "G-DTS4YZL86F"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app); // これをApp.jsxで使います