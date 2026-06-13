// ==========================================
// 1. Supabase の初期化設定
// ==========================================
const SUPABASE_URL = "https://fmqdfvmofmndqzzxekch.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_B8UXILiO5S5CKS1qdyZxyA_WC9Ynk5k";

// Supabaseクライアントの作成 (HTML側で読み込んだSDKを使用)
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// 2. 植物データ（空にしておき、DBから読み込みます）
// ==========================================
let plantsData = [];

// ==========================================
// 3. DOM要素の取得
// ==========================================
const plantList = document.getElementById('plantList');
const cameraModal = document.getElementById('cameraModal');
const video = document.getElementById('video');
const overlayPhoto = document.getElementById('overlayPhoto');
const statusMsg = document.getElementById('statusMsg');

let localStream = null;
let currentPlantId = null;

// パラパラ漫画再生の関連要素
const playbackModal = document.getElementById('playbackModal');
const playbackImage = document.getElementById('playbackImage');
const playbackMeta = document.getElementById('playbackMeta');
const closePlaybackBtn = document.getElementById('closePlaybackBtn');
const playbackStatus = document.getElementById('playbackStatus');

let playbackInterval = null; // タイマー用の変数

// --- 【さらに強化版】Supabaseから植物一覧と最新写真を確実に取得する ---
async function fetchPlants() {
    plantList.innerHTML = "<p>植物データを読み込み中...</p>";
    
    try {
        const { data: plants, error: plantError } = await supabaseClient
            .from('plants')
            .select('*')
            .order('created_at', { ascending: true });

        if (plantError) throw plantError;

        if (!plants || plants.length === 0) {
            plantList.innerHTML = "<p>登録されている植物がありません。</p>";
            return;
        }

        // 各植物の最新の1枚を取得
        plantsData = await Promise.all(plants.map(async (plant) => {
            const { data: records, error: recordError } = await supabaseClient
                .from('growth_records')
                .select('photo_url')
                .eq('plant_id', plant.id)
                .order('created_at', { ascending: false }) // ★record_dateではなく、データが作られた日時（created_at）の新しい順にする
                .limit(1);

            if (recordError) console.error("レコード取得失敗:", recordError);

            // 確実にURLを取得するためのログ（動かない時はブラウザのコンソールを見てください）
            console.log(`${plant.name}の最新レコード:`, records);

            const lastPhoto = (records && records.length > 0) ? records[0].photo_url : '';
            
            return {
                ...plant,
                lastPhoto: lastPhoto
            };
        }));

        renderPlants();

    } catch (error) {
        console.error('データ取得エラー:', error);
        plantList.innerHTML = `<p style="color:red;">エラーが発生しました: ${error.message}</p>`;
    }
}

// 植物リストの画面描画
// --- 【修正版】植物リストの画面描画（シンプルにIDだけを渡すようにします） ---
function renderPlants() {
    plantList.innerHTML = plantsData.map(plant => `
        <div class="plant-item">
            <div class="plant-info">
                <h3>${plant.name}</h3>
            </div>
            <div class="btn-group">
                <button class="btn-camera" onclick="openCamera('${plant.id}')">カメラ起動</button>
                <button class="btn-playback" onclick="startPlayback('${plant.id}')">再生</button>
            </div>
        </div>
    `).join('');
}

// --- 【決定版】カメラ起動処理（起動した瞬間に最新の写真をSupabaseに直接聞きに行く） ---
async function openCamera(plantId) {
    currentPlantId = plantId;
    
    // HTMLのid（大文字小文字）に合わせてJavaScript側で要素を確実に掴みます
    const modal = document.getElementById('cameraModal');
    const videoEl = document.getElementById('video');
    const overlayImg = document.getElementById('overlayPhoto');

    try {
        // 1. カメラを開いた瞬間に、この植物の「最新の1枚」をSupabaseから直接取得する
        const { data: records, error: recordError } = await supabaseClient
            .from('growth_records')
            .select('photo_url')
            .eq('plant_id', plantId)
            .not('photo_url', 'is', null)
            .order('created_at', { ascending: false }) // 登録されたのが新しい順
            .limit(1);

        if (recordError) throw recordError;

        // 2. 写真が存在すれば透かしを表示、なければ非表示
        if (records && records.length > 0) {
            console.log("【検証】透かし画像を発見しました！URL:", records[0].photo_url);
            overlayImg.src = records[0].photo_url;
            overlayImg.style.display = 'block'; 
        } else {
            console.log("【検証】この植物にはまだ写真がありません（透かしなし）");
            overlayImg.style.display = 'none';
        }

        // 3. カメラ映像を起動する
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }, // 外カメラ優先
            audio: false
        });
        videoEl.srcObject = localStream;
        modal.style.display = 'flex';

    } catch (err) {
        console.error('カメラ起動またはデータ取得エラー:', err);
        alert('カメラを起動できませんでした: ' + err.message);
    }
}

// ==========================================
// 4. 撮影・ハイブリッド圧縮・Supabase保存
// ==========================================

// 1. 撮影（パシャリ）ボタンの設定
const captureBtn = document.getElementById('captureBtn');
if (captureBtn) {
    captureBtn.removeAttribute('onclick'); // 二重登録を防ぐため、古い設定があれば消す
    
    captureBtn.addEventListener('click', async () => {
        statusMsg.innerText = "画像を圧縮中...";
        captureBtn.disabled = true;
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const targetWidth = 1200;
        const scale = targetWidth / video.videoWidth;
        const targetHeight = video.videoHeight * scale;

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(async (blob) => {
            if (!blob) {
                alert('画像圧縮に失敗しました。');
                resetShutterButton();
                return;
            }

            statusMsg.innerText = "Supabaseへアップロード中...";
            
            try {
                await uploadAndRecord(currentPlantId, blob);
                alert('クラウドへの保存が完了しました！');
                closeCamera();
                
                // 保存が終わったら最新の状態を再読み込み
                fetchPlants();
            } catch (error) {
                console.error(error);
                alert('保存中にエラーが発生しました: ' + error.message);
            } finally {
                resetShutterButton();
            }

        }, 'image/webp', 0.7);
    });
} else {
    console.error("エラー: captureBtn がHTMLに見つかりません");
}

// 2. 閉じるボタンの設定
const closeBtn = document.getElementById('closeBtn');
if (closeBtn) {
    closeBtn.removeAttribute('onclick');
    closeBtn.addEventListener('click', closeCamera);
} else {
    console.error("エラー: closeBtn がHTMLに見つかりません");
}

// シャッターボタンの状態を元に戻す補助関数（もし他になければここに置いておきます）
function resetShutterButton() {
    if (captureBtn) captureBtn.disabled = false;
    const statusMsg = document.getElementById('statusMsg');
    if (statusMsg) statusMsg.innerText = "";
}

function resetShutterButton() {
    captureBtn.disabled = false;
    statusMsg.innerText = "";
}

// ==========================================
// 5. Storage & Database 連動関数
// ==========================================
async function uploadAndRecord(plantId, blob) {
    const fileName = `plant_${plantId}_${Date.now()}.webp`;
    
    // A. Storageへ保存
    const { data: storageData, error: storageError } = await supabaseClient.storage
        .from('plant-photos')
        .upload(fileName, blob, {
            contentType: 'image/webp',
            cacheControl: '3600'
        });

    if (storageError) throw new Error('Storageエラー: ' + storageError.message);

    // B. 公開URL取得
    const { data: urlData } = supabaseClient.storage
        .from('plant-photos')
        .getPublicUrl(fileName);
        
    const publicUrl = urlData.publicUrl;

    // C. Database(growth_records)へ保存
    const today = new Date().toISOString().split('T')[0];
    
    const { error: dbError } = await supabaseClient
        .from('growth_records')
        .insert([
            { 
                plant_id: plantId, // ★選択した植物の本物のUUIDがここに入ります！
                record_date: today, 
                photo_url: publicUrl,
                memo: "定点観測カメラから投稿"
            }
        ]);

    if (dbError) throw new Error('Databaseエラー: ' + dbError.message);
}

// カメラ終了
function closeCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    cameraModal.style.display = 'none';
    resetShutterButton();
}

closeBtn.addEventListener('click', closeCamera);

// ==========================================
// 6. パラパラ漫画（タイムラプス）再生処理
// ==========================================
async function startPlayback(plantId) {
    playbackStatus.innerText = "写真を読み込み中...";
    playbackModal.style.display = 'flex';
    
    try {
        const { data: records, error } = await supabaseClient
            .from('growth_records')
            .select('photo_url, record_date')
            .eq('plant_id', plantId)
            .not('photo_url', 'is', null)
            .order('record_date', { ascending: true });

        if (error) throw error;

        if (!records || records.length === 0) {
            alert('まだ写真が登録されていません。まずはカメラで撮影してください！');
            closePlayback();
            return;
        }

        playbackStatus.innerText = "再生中";
        
        let currentIndex = 0;
        let loopCount = 1; // ★【追加】現在の周回数をカウント（1周目からスタート）
        
        const showImage = (index) => {
            playbackImage.src = records[index].photo_url;
            playbackMeta.innerText = `${records[index].record_date} (${index + 1} / ${records.length}) [${loopCount}周目]`;
        };
        
        showImage(currentIndex);

        playbackInterval = setInterval(() => {
            currentIndex++;
            
            // 最後の写真まで再生し終わったときの判定
            if (currentIndex >= records.length) {
                if (loopCount >= 1) { 
                    // ★【変更】すでに2回（2周）再生完了していたらタイマーを止める
                    clearInterval(playbackInterval);
                    playbackStatus.innerText = "再生完了";
                    return; // 処理を終了
                }
                
                // まだ1周目の場合は、周回数を増やして最初からリピート
                loopCount++;
                currentIndex = 0;
            }
            
            showImage(currentIndex);
        }, 800);

    } catch (error) {
        console.error('再生エラー:', error);
        alert('読み込みに失敗しました: ' + error.message);
        closePlayback();
    }
}

// 再生をストップして閉じる
function closePlayback() {
    if (playbackInterval) {
        clearInterval(playbackInterval); // タイマーをクリア
    }
    playbackModal.style.display = 'none';
    playbackImage.src = ""; // 画像をクリア
    playbackStatus.innerText = "";
}

closePlaybackBtn.addEventListener('click', closePlayback);

// --- 【変更】初期実行時にDBからデータを取る ---
fetchPlants();


