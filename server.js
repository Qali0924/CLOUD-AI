const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// LISTA KLUCZY Z RENDERA
const apiKeys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2
].filter(key => key); // Pobiera tylko te, które wpisałeś w Environment

let currentKeyIndex = 0;

app.use(express.static('public'));

// FUNKCJA ROTACJI: Próbuje rozwiązać zadanie, zmieniając klucze w razie błędu 429
async function generateWithRotation(prompt, fileData, attempt = 0) {
    // Jeśli sprawdziliśmy już oba klucze i oba mają limit
    if (attempt >= apiKeys.length) {
        throw new Error("Wszystkie klucze wyczerpały limity. Odczekaj minutę! ⏳");
    }

    const currentKey = apiKeys[currentKeyIndex];
    const genAI = new GoogleGenerativeAI(currentKey);
    
    // Używamy modelu 2.0 Flash
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", 
        apiVersion: "v1beta" 
    });

    try {
        const result = await model.generateContent([prompt, fileData]);
        const response = await result.response;
        return response.text();
    } catch (error) {
        // Jeśli błąd to limit (429), przełączamy klucz i próbujemy jeszcze raz
        if (error.status === 429) {
            console.log(`⚠️ Klucz ${currentKeyIndex + 1} zajęty. Przełączam na zapasowy...`);
            currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
            return generateWithRotation(prompt, fileData, attempt + 1);
        }
        throw error;
    }
}

app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie! 📸" });

        const { subject, level, mode } = req.body;
        const fileData = {
            inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype }
        };

        const prompts = {
            matematyka: "Jesteś ekspertem matematyki.",
            polski: "Jesteś polonistą.",
            fizyka: "Jesteś fizykiem.",
            inne: "Jesteś wszechstronnym nauczycielem."
        };

        let basePrompt = prompts[subject] || prompts.inne;
        let styleInstruction = (mode === 'cheat') 
            ? "TRYB ŚCIĄGANIE: Zero teorii, same obliczenia i pogrubiony wynik. Bądź ekstremalnie szybki." 
            : "TRYB NAUKA: Wyjaśnij wszystko dokładnie krok po kroku.";

        const finalPrompt = `
        ${basePrompt} Poziom: ${level}.
        ${styleInstruction}
        ZASADY: Wzory w $...$, wynik końcowy w **$...$**. Pisz po polsku.`;

        // WYWOŁANIE ROTACJI ZAMIAST ZWYKŁEGO MODELU
        const text = await generateWithRotation(finalPrompt, fileData);
        res.json({ result: text });

    } catch (error) {
        console.error("Błąd serwera:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/chat', async (req, res) => {
    try {
        const { question, context } = req.body;
        // Czat też używa rotacji dla stabilności
        const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex]);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", apiVersion: "v1beta" });
        
        const prompt = `Uczeń otrzymał rozwiązanie: "${context}". Teraz pyta: "${question}". Odpowiedz krótko. Wzory w $...$.`;
        const result = await model.generateContent(prompt);
        res.json({ answer: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 System rotacji (2 klucze) aktywny na porcie ${PORT}`));
