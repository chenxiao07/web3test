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

// --- 1inch API 辅助函数 ---
async function fetch1inch(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = `${ONE_INCH_API_BASE_URL}${CHAIN_ID}/${endpoint}?${queryString}`;
    
    const headers = {
        "accept": "application/json",
        // "Authorization": `Bearer ${ONE_INCH_API_KEY}` // 如果需要API Key
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("1inch API Error Response:", errorData);
            throw new Error(`1inch API request failed: ${response.status} ${response.statusText} - ${errorData.description || JSON.stringify(errorData)}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching from 1inch API (${endpoint}):`, error);
        throw error;
    }
}

// --- 核心兑换逻辑 ---
async function handleFullSwap(tokenInAddress, tokenOutAddress, tokenInSymbol) {
    if (!userAddress || !signer) {
        alert('请先连接钱包!');
        return;
    }

    statusEl.textContent = `准备兑换全部 ${tokenInSymbol}...`;

    let tokenInContract;
    if (tokenInAddress.toLowerCase() === ZKJ_TOKEN_ADDRESS.toLowerCase()) {
        tokenInContract = zkjContract;
    } else if (tokenInAddress.toLowerCase() === B2_TOKEN_ADDRESS.toLowerCase()) {
        tokenInContract = b2Contract;
    } else {
        statusEl.textContent = "无效的输入代币";
        return;
    }

    try {
        // 1. 获取全部余额
        const amountToSwap_wei = await tokenInContract.balanceOf(userAddress);
        const tokenInDecimals = await tokenInContract.decimals();

        if (amountToSwap_wei.isZero()) {
            statusEl.textContent = `您的 ${tokenInSymbol} 余额为0，无需兑换。`;
            return;
        }
        const amountToSwapFormatted = ethers.utils.formatUnits(amountToSwap_wei, tokenInDecimals);
        statusEl.textContent = `将兑换 ${amountToSwapFormatted} ${tokenInSymbol}.`;

        // 2. 获取1inch router地址 (spender) 以进行授权
        statusEl.textContent = "正在获取1inch Router地址...";
        const spenderResponse = await fetch1inch('approve/spender');
        const spenderAddress = spenderResponse.address;
        statusEl.textContent = `1inch Router: ${spenderAddress}. 正在检查授权...`;

        // 3. 授权 (Approve)
        const allowance = await tokenInContract.allowance(userAddress, spenderAddress);
        if (allowance.lt(amountToSwap_wei)) {
            statusEl.textContent = `正在授权1inch使用您的 ${tokenInSymbol}...`;
            const approveTx = await tokenInContract.approve(spenderAddress, ethers.constants.MaxUint256); // 授权最大值，简化后续操作
            await approveTx.wait();
            statusEl.textContent = `${tokenInSymbol} 授权成功!`;
        } else {
            statusEl.textContent = `${tokenInSymbol} 已授权。`;
        }

        // 4. 获取兑换参数 (Swap data from 1inch)
        statusEl.textContent = `正在从1inch获取兑换数据...`;
        const swapParams = {
            src: tokenInAddress,
            dst: tokenOutAddress,
            amount: amountToSwap_wei.toString(),
            from: userAddress,
            slippage: SLIPPAGE.toString(),
            disableEstimate: 'true', // 如果遇到 " μέρος των δεδομένων που καθορίσατε δεν ήταν έγκυρο" 或 "validation error" 可以尝试true/false
            // includeTokensInfo: 'true', // 可选，获取更多代币信息
            // includeProtocols: 'true', // 可选，获取协议信息
            // gasLimit: '3000000' // 1inch 会估算gas，一般不用自己设置
        };
        
        const swapData = await fetch1inch('swap', swapParams);

        // 1inch返回的交易对象包含了 to, data, value, gas (有时是gasPrice)
        // 我们需要确保所有字段都传递给 sendTransaction
        const tx = {
            to: swapData.tx.to,
            data: swapData.tx.data,
            value: swapData.tx.value, // 通常是 '0' for token swaps
            // gasPrice: swapData.tx.gasPrice, // MetaMask会自动处理，但如果1inch提供了，可以考虑使用
            // gasLimit: swapData.tx.gas // 1inch会预估gas limit
        };
        
        // 如果1inch返回了gasLimit，使用它。否则让钱包估算。
        if (swapData.tx.gas) {
            tx.gasLimit = ethers.BigNumber.from(swapData.tx.gas).toHexString(); // 确保是十六进制
        }


        statusEl.textContent = `准备发送交易到钱包...`;
        // 5. 执行兑换 (Send transaction)
        const transactionResponse = await signer.sendTransaction(tx);
        statusEl.innerHTML = `交易已发送: <a href="${IS_TESTNET ? 'https://testnet.bscscan.com/tx/' : 'https://bscscan.com/tx/'}${transactionResponse.hash}" target="_blank">${transactionResponse.hash}</a>. 等待确认...`;

        await transactionResponse.wait();
        statusEl.innerHTML = `交易成功! <a href="${IS_TESTNET ? 'https://testnet.bscscan.com/tx/' : 'https://bscscan.com/tx/'}${transactionResponse.hash}" target="_blank">查看交易</a>`;

        updateBalances();

    } catch (error) {
        console.error("兑换失败:", error);
        let errorMessage = `兑换失败: ${error.message || error}`;
        if (error.data && error.data.message) {
             errorMessage += ` - ${error.data.message}`;
        } else if (error.reason) {
             errorMessage += ` - ${error.reason}`;
        } else if (error.error && error.description) { // 1inch API error format
             errorMessage = `1inch API 错误: ${error.description} (Code: ${error.statusCode})`;
        }
        statusEl.textContent = errorMessage;
    }
}

// --- 启动DApp ---
window.addEventListener('load', init);
