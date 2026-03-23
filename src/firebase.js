import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAghSMSajX2wqknLvlW9jwkxECWGNQKjfg",
  authDomain: "handyjob-d3464.firebaseapp.com",
  projectId: "handyjob-d3464",
  storageBucket: "handyjob-d3464.firebasestorage.app",
  messagingSenderId: "236600149676",
  appId: "1:236600149676:web:26b70222030d492aaf8109"
};

// const firebaseConfig = {
//   apiKey: "AIzaSyCSzjSHxROMPBJesdqmQEVjReKHzUMwgX0",
//   authDomain: "handyman-106c4.firebaseapp.com",
//   projectId: "handyman-106c4",
//   storageBucket: "handyman-106c4.firebasestorage.app",
//   messagingSenderId: "107961183607",
//   appId: "1:107961183607:web:330c68b6d47971e27d0572",
// };

// const firebaseConfig = {
//   apiKey: "AIzaSyCSzjSHxROMPBJesdqmQEVjReKHzUMwgX0",
//   authDomain: "handyman-106c4.firebaseapp.com",
//   projectId: "handyman-106c4",
//   storageBucket: "handyman-106c4.firebasestorage.app",
//   messagingSenderId: "107961183607",
//   appId: "1:107961183607:web:1dea619ade370b8f7d0572"
// };

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

