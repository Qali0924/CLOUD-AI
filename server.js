const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static('public'));

app.post('/solve', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Wgraj zdjęcie!" });

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
// ... fragment wewnątrz app.post('/solve') ...
const prompt = `Jesteś ekspertem matematycznym. Rozwiąż zadanie ze zdjęcia.
ZASADY FORMATOWANIA:
1. Każdy wzór, liczbę z pierwiastkiem lub potęgę bierz w znaki dolara, np. $2+2=4$.
2. NAJWAŻNIEJSZE WYNIKI (kroki przejściowe i wynik końcowy) zapisuj wewnątrz podwójnych gwiazdek i dolarów, np. **$wynik$**.
3. Pisz czytelnie, krok po kroku. Używaj zielonych akcentów w opisie (instrukcja dla CSS).`;
// ... reszta kodu ...

        const result = await model.generateContent([
            prompt,
            { inlineData: { data: req.file.buffer.toString("base64"), mimeType: req.file.mimetype } }
        ]);

        const response = await result.response;
        res.json({ result: response.text() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => console.log(`🚀 Serwer działa na porcie 3000`));