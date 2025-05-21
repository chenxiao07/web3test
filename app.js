// --- 配置 ---
const IS_TESTNET = false; // true 使用测试网, false 使用主网

const ZKJ_TOKEN_ADDRESS = IS_TESTNET ? 'ZKJ_TESTNET_ADDRESS_HERE' : '0xc71b5f631354be6853efe9c3ab6b9590f8302e81'; // 替换
const B2_TOKEN_ADDRESS = IS_TESTNET ? 'B2_TESTNET_ADDRESS_HERE' : '0x783c3f003f172c6ac5ac700218a357d2d66ee2a2';   // 替换

const CHAIN_ID = IS_TESTNET ? 97 : 56; // BSC Testnet: 97, BSC Mainnet: 56
const ONE_INCH_API_BASE_URL = 'https://api.1inch.dev/swap/v6.0/'; // 检查最新API版本
// 通常不需要API Key做基础查询和交易，但高频使用可能需要。
// const ONE_INCH_API_KEY = 'YOUR_1INCH_API_KEY_IF_NEEDED'; // 替换

const SLIPPAGE = 1; // 交易滑点百分比 (例如: 1 for 1%)

// --- ABIs ---
const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

// --- 全局变量 ---
let provider;
let signer;
let userAddress;
let zkjContract, b2Contract;

// --- DOM元素 ---
const connectWalletBtn = document.getElementById('connectWalletBtn');
const walletAddressEl = document.getElementById('walletAddress');
const zkjBalanceEl = document.getElementById('zkjBalance');
const b2BalanceEl = document.getElementById('b2Balance');
const refreshBalancesBtn = document.getElementById('refreshBalancesBtn');
const swapAllZKJtoB2Btn = document.getElementById('swapAllZKJtoB2Btn');
const swapAllB2toZKJBBtn = document.getElementById('swapAllB2toZKJBBtn');
const statusEl = document.getElementById('status');
const logAreaEl = document.getElementById('logArea'); // 新增


// --- 日志函数 ---
function logMessage(message, type = 'info') { // type can be 'info', 'error', 'success', 'warn'
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.classList.add(`log-${type}`);
    logEntry.innerHTML = `[${timestamp}] ${message.replace(/\n/g, '<br>')}`; // Replace newlines with <br> for HTML
    
    // Prepend to keep newest on top, or append for chronological
    logAreaEl.prepend(logEntry); // 新消息在顶部
    // logAreaEl.appendChild(logEntry); // 新消息在底部 (如果需要滚动到底部，还需额外JS)
    // logAreaEl.scrollTop = 0; // 如果prepend，滚动到顶部

    // 同时更新简短状态
    if (type === 'error') {
        statusEl.textContent = `错误: ${message.split('\n')[0]}`; // 显示错误的第一行作为简短状态
        statusEl.className = 'error';
    } else if (type === 'success') {
        statusEl.textContent = `成功: ${message.split('\n')[0]}`;
        statusEl.className = 'success';
    } else {
        statusEl.textContent = message.split('\n')[0];
        statusEl.className = '';
    }
    console[type === 'error' ? 'error' : 'log'](message); // 也在控制台输出
}


// --- 初始化 ---
async function init() {
    connectWalletBtn.addEventListener('click', connectWallet);
    refreshBalancesBtn.addEventListener('click', updateBalances);
    swapAllZKJtoB2Btn.addEventListener('click', () => handleFullSwap(ZKJ_TOKEN_ADDRESS, B2_TOKEN_ADDRESS, 'ZKJ'));
    swapAllB2toZKJBBtn.addEventListener('click', () => handleFullSwap(B2_TOKEN_ADDRESS, ZKJ_TOKEN_ADDRESS, 'B2'));

    if (typeof window.ethereum !== 'undefined') {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        // 监听账户和网络变化
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', (_chainId) => window.location.reload());
        
        // 尝试自动连接如果之前已授权
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
            handleAccountsChanged(accounts);
        }

    } else {
        statusEl.textContent = '请安装或使用支持EIP-1193的钱包 (如MetaMask, Binance Web3 Wallet等)';
        connectWalletBtn.disabled = true;
    }
}

function handleAccountsChanged(accounts) {
    if (accounts.length > 0) {
        userAddress = accounts[0];
        walletAddressEl.textContent = userAddress;
        signer = provider.getSigner();
        checkNetworkAndInitialize();
    } else {
        userAddress = null;
        walletAddressEl.textContent = '未连接';
        signer = null;
        disableButtons();
        clearBalances();
        statusEl.textContent = "钱包已断开连接";
    }
}

async function checkNetworkAndInitialize() {
    const network = await provider.getNetwork();
    if (network.chainId !== CHAIN_ID) {
        statusEl.innerHTML = `请将钱包网络切换到 ${IS_TESTNET ? 'BSC Testnet' : 'BSC Mainnet'} (Chain ID: ${CHAIN_ID}). 
                              当前网络: ${network.name} (ID: ${network.chainId})`;
        try {
             await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: ethers.utils.hexValue(CHAIN_ID) }],
            });
            // 切换成功后，chainChanged事件会触发页面重载，或者可以手动调用初始化
            initializeContracts();
            enableButtons();
            updateBalances();
        } catch (switchError) {
            console.error("切换网络失败", switchError);
            if (switchError.code === 4902) { // Chain not added
                 statusEl.innerHTML += `<br>请先将网络添加到您的钱包中。`;
                 // 此处可以添加添加网络的逻辑，但为了简化，我们提示用户手动添加
            }
            disableButtons();
            return;
        }
    }
    initializeContracts();
    enableButtons();
    updateBalances();
    statusEl.textContent = '钱包已连接!';
}


async function connectWallet() {
    if (!provider) return alert('钱包提供者未找到!');
    try {
        const accounts = await provider.send("eth_requestAccounts", []);
        handleAccountsChanged(accounts);
    } catch (error) {
        console.error("连接钱包失败:", error);
        statusEl.textContent = `连接钱包失败: ${error.message || error}`;
    }
}

function initializeContracts() {
    if (!signer) return;
    zkjContract = new ethers.Contract(ZKJ_TOKEN_ADDRESS, ERC20_ABI, signer);
    b2Contract = new ethers.Contract(B2_TOKEN_ADDRESS, ERC20_ABI, signer);
    console.log("合约已初始化");
}

async function updateBalances() {
    if (!userAddress || !zkjContract || !b2Contract) return;
    try {
        statusEl.textContent = "正在获取余额...";
        const zkjDecimals = await zkjContract.decimals();
        const b2Decimals = await b2Contract.decimals();

        const zkjBal = await zkjContract.balanceOf(userAddress);
        const b2Bal = await b2Contract.balanceOf(userAddress);

        zkjBalanceEl.textContent = ethers.utils.formatUnits(zkjBal, zkjDecimals);
        b2BalanceEl.textContent = ethers.utils.formatUnits(b2Bal, b2Decimals);
        statusEl.textContent = "余额已更新";
    } catch (error) {
        console.error("更新余额失败:", error);
        statusEl.textContent = `更新余额失败: ${error.message}`;
    }
}

function enableButtons() {
    refreshBalancesBtn.disabled = false;
    swapAllZKJtoB2Btn.disabled = false;
    swapAllB2toZKJBBtn.disabled = false;
}
function disableButtons() {
    refreshBalancesBtn.disabled = true;
    swapAllZKJtoB2Btn.disabled = true;
    swapAllB2toZKJBBtn.disabled = true;
}
function clearBalances() {
    zkjBalanceEl.textContent = "0";
    b2BalanceEl.textContent = "0";
}

// --- 1inch API 辅助函数 (增强错误捕获) ---
async function fetch1inch(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = `${ONE_INCH_API_BASE_URL}${CHAIN_ID}/${endpoint}?${queryString}`;
    logMessage(`发送1inch API请求: ${url}`, "info");
    
    const headers = {
        "accept": "application/json",
        // "Authorization": `Bearer ${ONE_INCH_API_KEY}` // 如果需要
    };

    try {
        const response = await fetch(url, { headers });
        logMessage(`1inch API 响应状态: ${response.status} ${response.statusText}`, response.ok ? "info" : "warn");

        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json(); // 尝试解析JSON错误体
                logMessage(`1inch API 错误响应体: ${JSON.stringify(errorData, null, 2)}`, "error");
            } catch (e) {
                // 如果响应体不是JSON或者解析失败
                const textError = await response.text();
                logMessage(`1inch API 错误响应 (非JSON): ${textError}`, "error");
                errorData = { description: textError || `HTTP error ${response.status}`};
            }
            throw new Error(`1inch API request failed: ${response.status} ${response.statusText} - ${errorData.description || JSON.stringify(errorData)}`);
        }
        const data = await response.json();
        logMessage(`1inch API 响应成功 (${endpoint}).`, "success");
        // logMessage(`1inch API 响应数据: ${JSON.stringify(data, null, 2)}`, "info"); // 可以取消注释查看详细数据
        return data;
    } catch (error) { //捕获 fetch 本身的错误 (如网络问题) 或上面抛出的错误
        logMessage(`调用1inch API (${endpoint}) 失败: ${error.message}\nURL: ${url}\nError Object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`, "error");
        //  JSON.stringify(error, Object.getOwnPropertyNames(error)) 会尝试序列化错误对象的更多属性
        throw error; // 重新抛出，让调用者处理
    }
}

// --- 核心兑换逻辑 (使用 logMessage) ---
async function handleFullSwap(tokenInAddress, tokenOutAddress, tokenInSymbol) {
    if (!userAddress || !signer) {
        logMessage('请先连接钱包并确保网络正确!', 'error');
        return;
    }

    logMessage(`开始兑换全部 ${tokenInSymbol} 为 ${tokenOutAddress === ZKJ_TOKEN_ADDRESS ? 'ZKJ' : 'B2'}...`, "info");

    let tokenInContract;
    if (tokenInAddress.toLowerCase() === ZKJ_TOKEN_ADDRESS.toLowerCase()) {
        tokenInContract = zkjContract;
    } else if (tokenInAddress.toLowerCase() === B2_TOKEN_ADDRESS.toLowerCase()) {
        tokenInContract = b2Contract;
    } else {
        logMessage("无效的输入代币地址。", "error");
        return;
    }
     if (!tokenInContract) {
        logMessage(`输入代币 ${tokenInSymbol} 合约未初始化。`, "error");
        return;
    }


    try {
        // 1. 获取全部余额
        logMessage(`正在获取 ${tokenInSymbol} 余额...`, "info");
        const amountToSwap_wei = await tokenInContract.balanceOf(userAddress);
        const tokenInDecimals = await tokenInContract.decimals();

        if (amountToSwap_wei.isZero()) {
            logMessage(`您的 ${tokenInSymbol} 余额为0，无需兑换。`, "warn");
            return;
        }
        const amountToSwapFormatted = ethers.utils.formatUnits(amountToSwap_wei, tokenInDecimals);
        logMessage(`准备兑换: ${amountToSwapFormatted} ${tokenInSymbol}.`, "info");

        // 2. 获取1inch router地址 (spender)
        logMessage("正在获取1inch Router (spender) 地址...", "info");
        const spenderResponse = await fetch1inch('approve/spender');
        const spenderAddress = spenderResponse.address;
        logMessage(`1inch Spender地址: ${spenderAddress}.`, "info");

        // 3. 授权 (Approve)
        logMessage(`正在检查 ${tokenInSymbol} 对 Spender 的授权...`, "info");
        const allowance = await tokenInContract.allowance(userAddress, spenderAddress);
        if (allowance.lt(amountToSwap_wei)) {
            logMessage(`授权不足 (${ethers.utils.formatUnits(allowance, tokenInDecimals)} < ${amountToSwapFormatted}). 正在请求授权...`, "warn");
            const approveTx = await tokenInContract.approve(spenderAddress, ethers.constants.MaxUint256);
            logMessage(`授权交易已发送: ${approveTx.hash}. 等待确认...`, "info");
            await approveTx.wait();
            logMessage(`${tokenInSymbol} 授权成功! Hash: ${approveTx.hash}`, "success");
        } else {
            logMessage(`${tokenInSymbol} 已充分授权 (${ethers.utils.formatUnits(allowance, tokenInDecimals)}).`, "info");
        }

        // 4. 获取兑换参数 (Swap data from 1inch)
        logMessage(`正在从1inch获取兑换数据 (amount: ${amountToSwap_wei.toString()})...`, "info");
        const swapParams = {
            src: tokenInAddress,
            dst: tokenOutAddress,
            amount: amountToSwap_wei.toString(),
            from: userAddress,
            slippage: SLIPPAGE.toString(),
            disableEstimate: 'true', 
            // permit: 'string' // For gasless approvals if supported and you have a permit string
        };
        
        const swapData = await fetch1inch('swap', swapParams);
        logMessage(`从1inch获取到交易数据: to=${swapData.tx.to}, value=${swapData.tx.value}, gas=${swapData.tx.gas || '由钱包估算'}`, "info");
        // logMessage(`完整交易数据: ${JSON.stringify(swapData.tx, null, 2)}`, "info");

        const tx = {
            to: swapData.tx.to,
            data: swapData.tx.data,
            value: swapData.tx.value,
        };
        
        if (swapData.tx.gas) {
            tx.gasLimit = ethers.BigNumber.from(swapData.tx.gas).toHexString();
        }
        if (swapData.tx.gasPrice) { // 有些钱包可能需要或更好地处理这个
             tx.gasPrice = ethers.BigNumber.from(swapData.tx.gasPrice).toHexString();
        }

        logMessage(`准备发送交易到钱包进行签名... Tx Details: ${JSON.stringify(tx, null, 2)}`, "info");
        // 5. 执行兑换 (Send transaction)
        const transactionResponse = await signer.sendTransaction(tx);
        const txExplorerUrl = `${IS_TESTNET ? 'https://testnet.bscscan.com/tx/' : 'https://bscscan.com/tx/'}${transactionResponse.hash}`;
        logMessage(`交易已发送! Hash: <a href="${txExplorerUrl}" target="_blank">${transactionResponse.hash}</a>. 等待区块链确认...`, "info");

        await transactionResponse.wait();
        logMessage(`交易成功确认! <a href="${txExplorerUrl}" target="_blank">查看交易详情</a>`, "success");

        updateBalances();

    } catch (error) {
        let detailedErrorMessage = `兑换操作失败: ${error.message || '未知错误'}`;
        if (error.code) detailedErrorMessage += ` (Code: ${error.code})`;
        if (error.reason) detailedErrorMessage += `\nReason: ${error.reason}`;
        if (error.data && error.data.message) detailedErrorMessage += `\nData Message: ${error.data.message}`;
        
        // 如果是1inch API抛出的特定错误格式
        if (error.error && error.description) { 
             detailedErrorMessage = `1inch API 错误: ${error.description} (Code: ${error.statusCode || 'N/A'}, Error: ${error.error})`;
        }
        
        // 检查是否是交易被拒绝的错误
        if (error.code === 4001 || (error.message && error.message.toLowerCase().includes("user denied"))) {
            detailedErrorMessage = "交易被用户拒绝。";
        } else if (error.message && error.message.toLowerCase().includes("failed to fetch")) {
            detailedErrorMessage = "网络请求失败 (Failed to fetch)。请检查您的网络连接和浏览器控制台是否有CORS或其他网络错误。确保1inch API可访问。";
        }

        logMessage(detailedErrorMessage, "error");
        // 也将详细信息记录到控制台，以防UI截断
        console.error("详细错误对象:", error);
    }
}

// --- 启动DApp ---
window.addEventListener('load', init);
