// --- 全局变量 ---
let provider; // 声明，但不在 init 时立即赋值
let signer;
let userAddress;
let zkjContract, b2Contract;

// --- DOM元素 ---
// (保持不变)

// --- 初始化函数 ---
async function init() {
    connectWalletBtn.addEventListener('click', connectWallet);
    refreshBalancesBtn.addEventListener('click', updateBalances);
    swapAllZKJtoB2Btn.addEventListener('click', () => handleFullSwap(ZKJ_TOKEN_ADDRESS, B2_TOKEN_ADDRESS, 'ZKJ'));
    swapAllB2toZKJBBtn.addEventListener('click', () => handleFullSwap(B2_TOKEN_ADDRESS, ZKJ_TOKEN_ADDRESS, 'B2'));

    // 检查 window.ethereum 是否存在
    if (typeof window.ethereum !== 'undefined') {
        console.log("Ethereum provider detected on page load.");
        connectWalletBtn.disabled = false; // 使连接按钮可用

        // 监听账户和网络变化
        // 这些监听器应该在 provider 实际被创建后更有意义，或者它们能独立于 provider 工作
        window.ethereum.on('accountsChanged', (accounts) => {
            console.log("Accounts changed:", accounts);
            if (provider) { // 仅当 provider 已初始化时才处理
                handleAccountsChanged(accounts);
            } else if (accounts.length > 0) {
                // 如果 provider 未初始化但有账户，说明钱包可能已经连接
                // 用户下次点击连接按钮时会处理
                statusEl.textContent = "检测到钱包账户，请点击连接按钮。";
            } else {
                statusEl.textContent = "钱包账户已断开。";
                disableButtons();
                clearBalances();
            }
        });

        window.ethereum.on('chainChanged', (_chainId) => {
            console.log("Chain changed:", _chainId);
            statusEl.textContent = "网络已更改，请重新加载页面或重新连接钱包以应用更改。";
            // 简单处理：重载页面以获取新的网络状态
            // 或者，如果provider已初始化，可以尝试更平滑地处理
            if (provider) {
                window.location.reload(); // 或者调用一个重新初始化的函数
            }
        });
        
        // 尝试获取已连接的账户，但不强制连接或报错
        // 这只是为了看看钱包是否已经“知道”这个DApp
        try {
            // 注意：此时 provider 可能还未实例化
            // const tempProvider = new ethers.providers.Web3Provider(window.ethereum);
            // const accounts = await tempProvider.listAccounts();
            // if (accounts.length > 0) {
            //    console.log("Found existing accounts on init (no auto-connect):", accounts);
            //    statusEl.textContent = "检测到先前连接的账户，请点击“连接钱包”以激活。";
            // }
        } catch(e) {
            console.warn("Could not list accounts on init (this is often normal):", e.message);
        }

    } else {
        statusEl.textContent = '钱包提供者 (window.ethereum) 未找到。请确保您的浏览器钱包已安装、激活，并刷新页面。';
        connectWalletBtn.disabled = true;
    }
}

// --- 钱包连接 ---
async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        alert('钱包提供者 (window.ethereum) 未找到。\n请确保您的浏览器钱包 (如MetaMask, Binance Web3 Wallet) 已安装并激活，然后尝试刷新页面。');
        statusEl.textContent = '钱包提供者未找到。';
        connectWalletBtn.disabled = true;
        return;
    }

    try {
        // 1. 请求账户权限
        // 这是EIP-1102标准方式，会提示用户连接
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

        if (accounts && accounts.length > 0) {
            // 2. 一旦用户授权，我们现在可以安全地创建 provider 和 signer
            provider = new ethers.providers.Web3Provider(window.ethereum, "any"); // "any" 允许网络变化
            
            // 现在调用 handleAccountsChanged 来设置用户地址、signer并进行后续初始化
            handleAccountsChanged(accounts);
        } else {
            statusEl.textContent = "未选择账户，或用户拒绝连接。";
            disableButtons();
        }
    } catch (error) {
        console.error("连接钱包失败:", error);
        let message = `连接钱包失败: ${error.message || '未知错误'}`;
        if (error.code === 4001) { // EIP-1193 userRejectedRequest error
            message = "用户拒绝了连接请求。";
        } else if (error.message && error.message.includes("already pending")) {
            message = "连接请求已在处理中，请检查您的钱包。";
        }
        statusEl.textContent = message;
        disableButtons();
    }
}

// --- 处理账户变化 ---
// 这个函数现在假定 provider 已经在 connectWallet 成功后被创建
function handleAccountsChanged(accounts) {
    if (!provider) {
        // 这种情况理论上不应该在正常流程中发生，因为 connectWallet 会先创建 provider
        console.warn("handleAccountsChanged called but provider is not initialized.");
        // 尝试再次初始化 provider，如果 window.ethereum 存在
        if (typeof window.ethereum !== 'undefined') {
            provider = new ethers.providers.Web3Provider(window.ethereum, "any");
        } else {
            statusEl.textContent = "钱包提供者丢失，请刷新。";
            disableButtons();
            return;
        }
    }

    if (accounts.length > 0) {
        userAddress = accounts[0];
        walletAddressEl.textContent = userAddress;
        signer = provider.getSigner(); // 获取signer
        checkNetworkAndInitialize(); // 检查网络并初始化合约等
    } else {
        userAddress = null;
        walletAddressEl.textContent = '未连接';
        signer = null;
        disableButtons();
        clearBalances();
        statusEl.textContent = "钱包已断开连接或无账户选定。";
    }
}

// --- 检查网络并初始化 ---
async function checkNetworkAndInitialize() {
    if (!provider || !signer) {
        statusEl.textContent = "钱包未完全连接，无法继续。";
        disableButtons();
        return;
    }
    try {
        const network = await provider.getNetwork();
        if (network.chainId !== CHAIN_ID) {
            statusEl.innerHTML = `请将钱包网络切换到 ${IS_TESTNET ? 'BSC Testnet' : 'BSC Mainnet'} (Chain ID: ${CHAIN_ID}). <br>当前网络: ${network.name} (ID: ${network.chainId})`;
            try {
                 await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: ethers.utils.hexValue(CHAIN_ID) }],
                });
                // 切换成功后，通常 'chainChanged' 事件会触发并可能导致页面重载或需要重新初始化
                // 为了确保，我们可以在这里再次检查网络并继续
                const newNetwork = await provider.getNetwork();
                if (newNetwork.chainId === CHAIN_ID) {
                    statusEl.textContent = '网络切换成功!';
                    initializeContracts();
                    enableButtons();
                    updateBalances();
                } else {
                    statusEl.textContent = '网络切换未完成，请手动切换。';
                    disableButtons();
                }
            } catch (switchError) {
                console.error("切换网络失败", switchError);
                if (switchError.code === 4902) { // Chain not added
                     statusEl.innerHTML += `<br>请先将 ${IS_TESTNET ? 'BSC Testnet' : 'BSC Mainnet'} 网络添加到您的钱包中。`;
                     // 可以在这里添加 `wallet_addEthereumChain` 的逻辑
                }
                disableButtons();
                return;
            }
        } else {
            // 网络正确
            initializeContracts();
            enableButtons();
            updateBalances();
            statusEl.textContent = '钱包已连接!';
        }
    } catch (error) {
        console.error("检查网络或初始化时出错:", error);
        statusEl.textContent = `检查网络或初始化时出错: ${error.message}`;
        disableButtons();
    }
}

// --- 初始化合约实例 ---
function initializeContracts() {
    if (!signer) {
        console.error("Signer未初始化，无法创建合约实例。");
        statusEl.textContent = "Signer未初始化，无法创建合约实例。";
        return;
    }
    try {
        zkjContract = new ethers.Contract(ZKJ_TOKEN_ADDRESS, ERC20_ABI, signer);
        b2Contract = new ethers.Contract(B2_TOKEN_ADDRESS, ERC20_ABI, signer);
        console.log("合约已初始化");
    } catch (e) {
        console.error("合约初始化失败:", e);
        statusEl.textContent = `合约初始化失败: ${e.message}`;
    }
}

/*
    其他函数 (updateBalances, enableButtons, disableButtons, clearBalances, fetch1inch, handleFullSwap)
    保持不变，但请确保它们在调用前，相关的 provider, signer, 和合约实例已经成功初始化。
    例如，在 handleFullSwap 的开头可以再次检查 signer 是否存在。
*/

// --- 启动DApp ---
window.addEventListener('load', init);
