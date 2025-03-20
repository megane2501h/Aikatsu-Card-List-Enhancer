// ==UserScript==
// @name         Aikatsu Card List Enhancer
// @namespace    https://www.aikatsu.com/
// @version      5.7
// @description  アイカツカードリストに無限スクロール・シンプル表示機能・所持カード管理機能を追加します。
// @author       megane
// @match        https://www.aikatsu.com/cardlist/*
// @match        http://www.aikatsu.com/cardlist/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // Core variables and settings
    const loadedCardIds = new Set();
    let isSimpleView = false;
    const userSettings = {
        ownedCards: GM_getValue('ownedCards', {}),
        cardSize: GM_getValue('cardSize', 180),
        fullWidth: GM_getValue('fullWidth', false)
    };
    const savedFilterState = {
        activeTypeFilters: [],
        activeCategoryFilters: [],
        activeRarityFilters: [],
        activeOwnershipFilter: 'all',
        searchTerm: ''
    };

    // Card data extraction utilities
    const extractCardId = card => card.querySelector('th')?.textContent.trim().split('<')[0].trim();
    const extractCardImagePath = card => card.querySelector('.td-cardimg img')?.getAttribute('src');
    const extractCardName = card => {
        for (const selector of ['.ltd.tit-cute', '.ltd.tit-cool', '.ltd.tit-sexy', '.ltd.tit-accessory', '.ltd.tit-pop']) {
            const elem = card.querySelector(selector);
            if (elem?.nextElementSibling) return elem.nextElementSibling.textContent.trim();
        }
        return '不明なカード';
    };

    // Card type/category/rarity determination
    const determineCardType = card => {
        const typeMap = {'.card-cute':'cute', '.card-cool':'cool', '.card-sexy':'sexy', '.card-accessory':'accessory', '.card-pop':'pop'};
        for (const [selector, type] of Object.entries(typeMap)) if (card.querySelector(selector)) return type;
        return '';
    };

    const determineCardCategory = card => {
        const categoryMap = {
            'icon-cttops.jpg': 'tops',
            'icon-ctbottoms.jpg': 'bottoms',
            'icon-ctshoes.jpg': 'shoes',
            'icon-ctaccessory.jpg': 'accessory',
            'icon-cttb.jpg': 'topsbottoms'
        };

        // Check image sources
        const images = card.querySelectorAll('img');
        for (const img of images) {
            const src = img.getAttribute('src');
            if (!src) continue;
            for (const [imgPart, category] of Object.entries(categoryMap)) {
                if (src.includes(imgPart)) return category;
            }
        }

        // Fallback to text content
        const allText = card.textContent;
        if (allText.includes('トップス＆ボトムス')) return 'topsbottoms';
        if (allText.includes('トップス')) return 'tops';
        if (allText.includes('ボトムス')) return 'bottoms';
        if (allText.includes('シューズ')) return 'shoes';
        if (allText.includes('アクセサリー')) return 'accessory';

        return 'unknown';
    };

    const extractCardRarity = card => {
        const rarityMap = {'ノーマル':'normal', 'レア':'rare', 'プレミアムレア':'premium', 'キャンペーンレア':'campaign'};
        const isAccessory = card.querySelector('table.card-accessory') !== null;

        // Method 1: Check headers
        for (const header of card.querySelectorAll('.tit-cute, .tit-cool, .tit-sexy, .tit-pop, .tit-accessory')) {
            if (header.textContent.trim() === 'レアリティ') {
                const row = header.closest('tr');
                const nextRow = row?.nextElementSibling;
                if (nextRow) {
                    const cellIndex = Array.from(row.cells).indexOf(header);
                    if (cellIndex >= 0 && nextRow.cells.length > cellIndex) {
                        const text = nextRow.cells[cellIndex].textContent.trim();
                        if ((isAccessory && rarityMap[text]) || rarityMap[text]) return rarityMap[text];
                        if (text === '-') return 'none';
                    }
                }
            }
        }

        // Method 2: Scan all rows for rarity information
        const rows = card.querySelectorAll('tr');
        for (let i = 0; i < rows.length; i++) {
            const cells = rows[i].querySelectorAll('td');
            const isRarityRow = Array.from(cells).some(cell =>
                cell.textContent.trim() === 'レアリティ' ||
                (cell.classList.contains('tit-accessory') && cell.textContent.trim() === 'レアリティ'));

            if (isRarityRow && i + 1 < rows.length) {
                for (const cell of rows[i+1].querySelectorAll('td')) {
                    const text = cell.textContent.trim();
                    if ((isAccessory && rarityMap[text]) || rarityMap[text]) return rarityMap[text];
                }
            }

            for (const cell of cells) {
                const text = cell.textContent.trim();
                if ((isAccessory && rarityMap[text]) || rarityMap[text]) return rarityMap[text];
                if (text === '-' && i > 0 && rows[i-1].textContent.includes('レアリティ')) return 'none';
            }
        }

        return isAccessory ? 'none' : 'unknown';
    };

    // UI Helper Functions
    const updateFilterState = () => {
        const filterTypes = {
            'type': savedFilterState.activeTypeFilters = [],
            'category': savedFilterState.activeCategoryFilters = [],
            'rarity': savedFilterState.activeRarityFilters = []
        };

        document.querySelectorAll('.filter-btn.active').forEach(btn => {
            const type = btn.dataset.filterType;
            const filter = btn.dataset.filter;
            if (filterTypes[type] && filter) filterTypes[type].push(filter);
        });
    };

    const updateFilterCounts = () => {
        const isDetailView = !isSimpleView;
        const countByType = {}, countByCategory = {}, countByRarity = {};

        // Count displayed cards by type, category, and rarity
        const cards = document.querySelectorAll(isSimpleView ? '.simple-card:not(.hidden-card)' : '.card[style=""]');

        cards.forEach(card => {
            if (isDetailView && card.style.display === 'none') return;

            let type, category, rarity;

            if (isSimpleView) {
                type = Array.from(card.classList).find(cls => ['cute','cool','sexy','pop','accessory'].includes(cls));
                category = card.dataset.category;
                rarity = card.dataset.rarity;
            } else {
                type = determineCardType(card);
                category = determineCardCategory(card);
                rarity = extractCardRarity(card);
            }

            if (type) countByType[type] = (countByType[type] || 0) + 1;
            if (category) countByCategory[category] = (countByCategory[category] || 0) + 1;
            if (rarity) countByRarity[rarity] = (countByRarity[rarity] || 0) + 1;
        });

        // Update filter button counts
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const counter = btn.querySelector('.filter-count');
            if (!counter) return;

            const type = btn.dataset.filterType;
            const filter = btn.dataset.filter;

            let count = 0;
            if (type === 'type') count = countByType[filter] || 0;
            else if (type === 'category') count = countByCategory[filter] || 0;
            else if (type === 'rarity') count = countByRarity[filter] || 0;

            counter.textContent = count;
        });
    };

    const clearAllFilters = () => {
        document.getElementById('enhanced-search-input').value = '';
        savedFilterState.searchTerm = '';

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.backgroundColor = '#f8f8f8';
            btn.style.color = '#333';

            const counter = btn.querySelector('.filter-count');
            if (counter) counter.style.backgroundColor = 'rgba(0,0,0,0.1)';
        });

        document.querySelectorAll('.ownership-filter-btn').forEach(btn => {
            if (btn.dataset.filter === 'all') {
                btn.classList.add('active');
                btn.style.backgroundColor = '#aaa';
                btn.style.color = 'white';
            } else {
                btn.classList.remove('active');
                btn.style.backgroundColor = '#f5f5f5';
                btn.style.color = '#333';
            }
        });

        savedFilterState.activeTypeFilters = [];
        savedFilterState.activeCategoryFilters = [];
        savedFilterState.activeRarityFilters = [];
        savedFilterState.activeOwnershipFilter = 'all';

        isSimpleView ? resetFilters() : resetDetailFilters();
    };

    const updateCardCount = count => {
        const el = document.getElementById('card-count-display');
        if (el) el.textContent = `表示: ${count}枚`;
    };

    const updateCollectionStats = () => {
        const collectionStats = document.getElementById('collection-stats');
        if (!collectionStats) return;

        const displayedCards = document.querySelectorAll('.card').length;
        const ownedCount = Object.keys(userSettings.ownedCards).length;

        collectionStats.innerHTML = `コレクション状況<br>表示：${displayedCards}枚<br>所持： ${ownedCount}枚`;
    };

    // Notification and clipboard functions
    const copyTextToClipboard = text => {
        const textArea = document.createElement('textarea');
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showCopyNotification(text);
    };

    const showCopyNotification = text => {
        const existingNotification = document.getElementById('copy-notification');
        if (existingNotification) document.body.removeChild(existingNotification);

        document.body.insertAdjacentHTML('beforeend', `<div id="copy-notification">テキスト「${text}」をコピーしました！</div>`);
        setTimeout(() => {
            document.getElementById('copy-notification').style.opacity = '0';
            setTimeout(() => document.getElementById('copy-notification')?.remove(), 300);
        }, 2000);
    };

    // Card ownership management
    const toggleCardOwnership = (imagePath, container, button) => {
        const isCurrentlyOwned = userSettings.ownedCards[imagePath];
        const img = container.querySelector('img');

        if (isCurrentlyOwned) {
            delete userSettings.ownedCards[imagePath];
            container.classList.remove('owned-card');
            container.classList.add('not-owned-card');
            if (img) img.title = 'クリックで所持済みに変更';
            if (button) {
                button.innerHTML = '○';
                button.title = 'クリックで所持済みに変更';
                button.classList.remove('owned');
            }
        } else {
            userSettings.ownedCards[imagePath] = true;
            container.classList.remove('not-owned-card');
            container.classList.add('owned-card');
            if (img) img.title = 'クリックで未所持に変更';
            if (button) {
                button.innerHTML = '✓';
                button.title = 'クリックで未所持に変更';
                button.classList.add('owned');
            }
        }

        updateOwnedStatusForImage(imagePath);
        GM_setValue('ownedCards', userSettings.ownedCards);
        updateCollectionStats();

        if (savedFilterState.activeOwnershipFilter !== 'all') {
            isSimpleView ? applyAllFilters() : applyDetailFilters();
        }
    };

    const updateOwnedStatusForImage = imagePath => {
        const isOwned = userSettings.ownedCards[imagePath];

        // Update detail view cards
        document.querySelectorAll('.card').forEach(card => {
            const img = card.querySelector('.td-cardimg img');
            if (img && img.getAttribute('src') === imagePath) {
                const tdCardimg = card.querySelector('.td-cardimg');
                const toggleButton = tdCardimg.querySelector('#toggle-ownership');

                if (isOwned) {
                    tdCardimg.classList.remove('not-owned-card');
                    tdCardimg.classList.add('owned-card');
                    img.title = 'クリックで未所持に変更';
                    if (toggleButton) {
                        toggleButton.innerHTML = '✓';
                        toggleButton.title = 'クリックで未所持に変更';
                        toggleButton.classList.add('owned');
                    }
                } else {
                    tdCardimg.classList.remove('owned-card');
                    tdCardimg.classList.add('not-owned-card');
                    img.title = 'クリックで所持済みに変更';
                    if (toggleButton) {
                        toggleButton.innerHTML = '○';
                        toggleButton.title = 'クリックで所持済みに変更';
                        toggleButton.classList.remove('owned');
                    }
                }
            }
        });

        // Update simple view cards
        document.querySelectorAll('.simple-card').forEach(card => {
            const img = card.querySelector('img');
            if (img && img.getAttribute('src') === imagePath) {
                const ownedIcon = card.querySelector('.owned-icon');

                if (isOwned) {
                    card.classList.add('owned-card');
                    if (!ownedIcon) {
                        const icon = document.createElement('div');
                        icon.className = 'owned-icon';
                        icon.textContent = '✓';
                        card.appendChild(icon);
                    }
                } else {
                    card.classList.remove('owned-card');
                    if (ownedIcon) ownedIcon.remove();
                }
            }
        });
    };

    const updateAllCardsOwnershipStatus = () => {
        // Update detail view cards
        document.querySelectorAll('.card').forEach(card => {
            const imgElem = card.querySelector('.td-cardimg img');
            if (imgElem) {
                const imagePath = imgElem.getAttribute('src');
                const isOwned = userSettings.ownedCards[imagePath];
                const tdCardimg = card.querySelector('.td-cardimg');
                const toggleButton = tdCardimg?.querySelector('#toggle-ownership');

                if (tdCardimg) {
                    tdCardimg.classList.toggle('owned-card', isOwned);
                    tdCardimg.classList.toggle('not-owned-card', !isOwned);
                    imgElem.title = isOwned ? 'クリックで未所持に変更' : 'クリックで所持済みに変更';
                }

                if (toggleButton) {
                    toggleButton.innerHTML = isOwned ? '✓' : '○';
                    toggleButton.title = isOwned ? 'クリックで未所持に変更' : 'クリックで所持済みに変更';
                    toggleButton.classList.toggle('owned', isOwned);
                }
            }
        });

        // Update simple view cards
        document.querySelectorAll('.simple-card').forEach(card => {
            const imgElem = card.querySelector('img');
            if (imgElem) {
                const imagePath = imgElem.getAttribute('src');
                const isOwned = userSettings.ownedCards[imagePath];
                const ownedIcon = card.querySelector('.owned-icon');

                card.classList.toggle('owned-card', isOwned);
                imgElem.title = isOwned ? 'クリックで未所持に変更' : 'クリックで所持済みに変更';

                if (isOwned && !ownedIcon) {
                    const icon = document.createElement('div');
                    icon.className = 'owned-icon';
                    icon.textContent = '✓';
                    card.appendChild(icon);
                } else if (!isOwned && ownedIcon) {
                    ownedIcon.remove();
                }
            }
        });
    };

    // Filter related functions
    const applyFilters = isSimple => {
        const cards = document.querySelectorAll(isSimple ? '.simple-card' : '.card');
        let visibleCount = 0;
        const {activeTypeFilters, activeCategoryFilters, activeRarityFilters, activeOwnershipFilter, searchTerm} = savedFilterState;

        cards.forEach(card => {
            let cardInfo;

            if (isSimple) {
                cardInfo = {
                    id: card.dataset.cardId.toLowerCase(),
                    name: card.querySelector('.simple-card-name').textContent.toLowerCase(),
                    type: Array.from(card.classList).find(cls => ['cute','cool','sexy','pop','accessory'].includes(cls)),
                    category: card.dataset.category,
                    rarity: card.dataset.rarity,
                    imagePath: card.querySelector('img')?.getAttribute('src') || '',
                    isOwned: card.classList.contains('owned-card')
                };
            } else {
                const id = extractCardId(card);
                const name = extractCardName(card);
                const imagePath = extractCardImagePath(card);

                cardInfo = {
                    id: id?.toLowerCase() || '',
                    name: name?.toLowerCase() || '',
                    type: determineCardType(card),
                    category: determineCardCategory(card),
                    rarity: extractCardRarity(card),
                    imagePath: imagePath || '',
                    isOwned: imagePath && userSettings.ownedCards[imagePath]
                };
            }

            const matchesSearch = !searchTerm || cardInfo.id.includes(searchTerm) || cardInfo.name.includes(searchTerm);
            const matchesType = !activeTypeFilters.length || activeTypeFilters.includes(cardInfo.type);
            const matchesCategory = !activeCategoryFilters.length || activeCategoryFilters.includes(cardInfo.category);
            const isNoneSelected = activeRarityFilters.includes('none');
            const matchesRarity = !activeRarityFilters.length ||
                (isNoneSelected ? cardInfo.rarity === 'none' : activeRarityFilters.includes(cardInfo.rarity));

            const matchesOwnership = activeOwnershipFilter === 'all' ||
                (activeOwnershipFilter === 'owned' && cardInfo.isOwned) ||
                (activeOwnershipFilter === 'missing' && !cardInfo.isOwned);

            const isVisible = matchesSearch && matchesType && matchesCategory && matchesRarity && matchesOwnership;

            if (isSimple) {
                card.classList.toggle('hidden-card', !isVisible);
            } else {
                card.style.display = isVisible ? '' : 'none';
            }

            if (isVisible) visibleCount++;
        });

        updateCardCount(visibleCount);
        updateFilterCounts();
        updateCollectionStats();
    };

    const applyAllFilters = () => applyFilters(true);
    const applyDetailFilters = () => applyFilters(false);

    const resetFilters = () => {
        document.querySelectorAll('.simple-card').forEach(card => card.classList.remove('hidden-card'));
        updateCardCount(document.querySelectorAll('.simple-card').length);
        updateFilterCounts();
        updateCollectionStats();
    };

    const resetDetailFilters = () => {
        document.querySelectorAll('.card').forEach(card => card.style.display = '');
        updateCardCount(document.querySelectorAll('.card').length);
        updateFilterCounts();
        updateCollectionStats();
    };

    // View mode functions
    const toggleSimpleView = () => {
        isSimpleView = !isSimpleView;
        const viewToggle = document.getElementById('toggle-view-mode');
        const displaySettings = document.getElementById('display-settings');

        if (isSimpleView) {
            document.body.classList.add('simple-view-mode');
            if (viewToggle) viewToggle.textContent = '詳細表示に戻す';
            if (displaySettings) displaySettings.style.display = 'flex';

            ['#search', '.btn_checklist', '.notice_aktphone'].forEach(selector => {
                const el = document.querySelector(selector);
                if (el) el.style.display = 'none';
            });

            if (userSettings.fullWidth) adjustLayoutStructure(true);
            createSimpleView();
        } else {
            document.body.classList.remove('simple-view-mode');
            if (viewToggle) viewToggle.textContent = 'シンプル表示に切替';
            if (displaySettings) displaySettings.style.display = 'none';

            ['#search', '.btn_checklist', '.notice_aktphone'].forEach(selector => {
                const el = document.querySelector(selector);
                if (el) el.style.display = '';
            });

            if (document.getElementById('simple-view')) document.getElementById('simple-view').style.display = 'none';
            document.getElementById('list').style.display = 'block';
            applyDetailFilters();
            adjustLayoutStructure(false);
        }
    };

    const adjustLayoutStructure = fullWidth => {
        if (fullWidth) {
            const css = `
                body,#container{background:white!important;background-image:none!important}
                #mainCol{width:100%!important;max-width:none!important;float:none!important;background:white!important;box-shadow:0 0 20px rgba(255,123,172,.2)!important;padding:20px!important;border-radius:10px!important;margin-top:20px!important}
                #wrapper-cardlist,#mainCol,#wrapCol,#list{width:100%!important;max-width:none!important;margin:0 auto!important;padding:0!important;float:none!important}
                #subCol,#pagetop{display:none!important}
                #simple-view{margin:20px auto!important;width:100%!important;max-width:none!important;padding:0!important;background:white!important}
                #search,.btn_checklist,.notice_aktphone{display:none!important}
                .mgHead{padding-top:20px!important}`;

            const style = document.getElementById('layout-override-style') || document.createElement('style');
            style.id = 'layout-override-style';
            style.textContent = css;
            if (!document.getElementById('layout-override-style')) document.head.appendChild(style);
            document.body.classList.add('full-width-mode');
        } else {
            document.getElementById('layout-override-style')?.remove();
            document.body.classList.remove('full-width-mode');

            if (!isSimpleView) {
                document.getElementById('search')?.style.removeProperty('display');
                document.querySelector('.btn_checklist')?.style.removeProperty('display');
                document.querySelector('.notice_aktphone')?.style.removeProperty('display');
            }
        }
    };

    const updateSimpleViewStyles = () => {
        const css = `
            .simple-card{width:${userSettings.cardSize}px;border-radius:8px;padding:8px;box-shadow:0 2px 4px rgba(0,0,0,.1);text-align:center;transition:all .2s ease;position:relative;overflow:visible}
            .simple-card:hover{transform:translateY(-5px);box-shadow:0 5px 15px rgba(0,0,0,.2);z-index:10}
            .simple-card img{width:100%;height:auto;border-radius:5px;transition:all .3s ease;cursor:pointer}
            .simple-card:hover img{transform:scale(1.02)}
            .card-info{display:flex;justify-content:center;align-items:center;margin-top:8px;gap:5px}
            .simple-card .simple-card-id{font-size:12px;font-weight:bold;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
            .simple-card .simple-card-id::after{content:"📋";font-size:9px;margin-left:2px}
            .simple-card .card-rarity{font-size:11px;font-weight:bold;padding:1px 5px;border-radius:10px;background-color:#f0f0f0}
            .simple-card[data-rarity="normal"] .card-rarity{background-color:#aaa;color:white}
            .simple-card[data-rarity="rare"] .card-rarity{background-color:#5d93e1;color:white}
            .simple-card[data-rarity="premium"] .card-rarity{background:linear-gradient(135deg,#F90,#FC0);color:white}
            .simple-card[data-rarity="campaign"] .card-rarity{background:linear-gradient(135deg,#F36,#F0C);color:white}
            .simple-card .simple-card-name{margin-top:4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
            .simple-card .simple-card-name::after{content:"📋";font-size:9px;margin-left:2px}
            .simple-card.cute{background-color:#FEEDF1;border:1px solid #FDA7C1;color:#BA3F66}
            .simple-card.cute:hover{background-color:#ffdce7;box-shadow:0 5px 15px rgba(253,167,193,.3)}
            .simple-card.cute .simple-card-id{color:#BA3F66}
            .simple-card.cool{background-color:#D0E3FF;border:1px solid #4977AE;color:#005BAC}
            .simple-card.cool:hover{background-color:#bcd6ff;box-shadow:0 5px 15px rgba(73,119,174,.3)}
            .simple-card.cool .simple-card-id{color:#005BAC}
            .simple-card.sexy{background-color:#E8CEE3;border:1px solid #8F57A0;color:#920783}
            .simple-card.sexy:hover{background-color:#ddbdd6;box-shadow:0 5px 15px rgba(143,87,160,.3)}
            .simple-card.sexy .simple-card-id{color:#920783}
            .simple-card.pop{background-color:#FFEEDD;border:1px solid #F90;color:#C60}
            .simple-card.pop:hover{background-color:#ffdfc4;box-shadow:0 5px 15px rgba(255,153,0,.3)}
            .simple-card.pop .simple-card-id{color:#C60}
            .simple-card.accessory{background-color:#E8E8E8;border:1px solid #666;color:#333}
            .simple-card.accessory:hover{background-color:#d5d5d5;box-shadow:0 5px 15px rgba(102,102,102,.3)}
            .simple-card.accessory .simple-card-id{color:#333}
            .hidden-card{display:none!important}
            .simple-card.owned-card{border-color:#5cb85c}
            .simple-card.owned-card img{box-shadow:0 0 0 3px #5cb85c}
            .owned-icon{position:absolute;top:-10px;left:-10px;background:#5cb85c;color:white;width:24px;height:24px;border-radius:50%;display:flex;justify-content:center;align-items:center;font-weight:bold;z-index:11;border:2px solid white;font-size:12px}`;

        const style = document.getElementById('simple-view-style') || document.createElement('style');
        style.id = 'simple-view-style';
        style.textContent = css;
        if (!document.getElementById('simple-view-style')) document.head.appendChild(style);
    };

    // Card view manipulation functions
    const createSimpleView = () => {
        document.getElementById('list').style.display = 'none';
        updateSimpleViewStyles();

        if (!document.getElementById('simple-view')) {
            const simpleView = document.createElement('div');
            simpleView.id = 'simple-view';
            simpleView.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:15px;margin:20px auto;width:100%;padding:10px;box-sizing:border-box;background-color:white;';

            document.querySelectorAll('.card').forEach(card => {
                card.style.display = '';
                addCardToSimpleView(card, simpleView);
            });

            document.getElementById('list').insertAdjacentElement('afterend', simpleView);
            simpleView.insertAdjacentHTML('beforeend', `<div id="end-message">全${document.querySelectorAll('.card').length}枚のカードを表示しています<br><small style="display:block;font-size:12px;color:#999;margin-top:5px;">※クリックでカードの所持状態を切り替えできます</small></div>`);

            setTimeout(() => {
                updateCardCount(document.querySelectorAll('.simple-card').length);
                applyAllFilters();
            }, 100);
        } else {
            document.getElementById('simple-view').style.display = 'flex';
            setTimeout(() => {
                updateCardCount(document.querySelectorAll('.simple-card').length);
                applyAllFilters();
            }, 100);
        }
    };

    const addCardToSimpleView = (card, container) => {
        const cardImgElement = card.querySelector('.td-cardimg img');
        if (!cardImgElement) return;

        const cardImg = cardImgElement.getAttribute('src');
        const cardId = extractCardId(card);
        if (!cardId) return;

        const cardName = extractCardName(card);
        const cardType = determineCardType(card);
        const cardCategory = determineCardCategory(card);
        const cardRarity = extractCardRarity(card);
        const rarityLabel = {normal:'N', rare:'R', premium:'PR', campaign:'CP', none:'-', unknown:'?'}[cardRarity];
        const isOwned = userSettings.ownedCards[cardImg];

        const simpleCard = document.createElement('div');
        simpleCard.className = `simple-card ${cardType}${isOwned ? ' owned-card' : ''}`;
        simpleCard.dataset.cardId = cardId;
        simpleCard.dataset.category = cardCategory;
        simpleCard.dataset.rarity = cardRarity;
        simpleCard.innerHTML = `
            <img src="${cardImg}" alt="${cardName}" loading="lazy" title="クリックで所持状態を切替">
            <div class="card-info">
                <div class="simple-card-id" title="IDをコピー">${cardId}</div>
                <div class="card-rarity">${rarityLabel}</div>
            </div>
            <div class="simple-card-name" title="カード名をコピー">${cardName}</div>
            ${isOwned ? '<div class="owned-icon">✓</div>' : ''}
        `;

        // Event handlers
        const img = simpleCard.querySelector('img');
        const idElement = simpleCard.querySelector('.simple-card-id');
        const nameElement = simpleCard.querySelector('.simple-card-name');

        img.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleSimpleCardOwnership(simpleCard, cardImg);
        });

        idElement.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            copyTextToClipboard(cardId);
        });

        nameElement.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            copyTextToClipboard(cardName);
        });

        simpleCard.addEventListener('click', e => {
            if (e.target !== img && e.target !== idElement && e.target !== nameElement) {
                goToDetailCard(cardId);
            }
        });

        container.appendChild(simpleCard);
    };

    const toggleSimpleCardOwnership = (card, imagePath) => {
        const isCurrentlyOwned = card.classList.contains('owned-card');

        if (isCurrentlyOwned) {
            delete userSettings.ownedCards[imagePath];
            card.classList.remove('owned-card');
            const ownedIcon = card.querySelector('.owned-icon');
            if (ownedIcon) ownedIcon.remove();
        } else {
            userSettings.ownedCards[imagePath] = true;
            card.classList.add('owned-card');
            if (!card.querySelector('.owned-icon')) {
                const icon = document.createElement('div');
                icon.className = 'owned-icon';
                icon.textContent = '✓';
                card.appendChild(icon);
            }
        }

        updateOwnedStatusForImage(imagePath);
        GM_setValue('ownedCards', userSettings.ownedCards);
        updateCollectionStats();

        if (savedFilterState.activeOwnershipFilter !== 'all') applyAllFilters();
    };

    const goToDetailCard = cardId => {
        if (isSimpleView) toggleSimpleView();

        setTimeout(() => {
            let card = document.getElementById(cardId) ||
                    [...document.querySelectorAll('.card')].find(c => c.querySelector(`table[id="${cardId}"]`)) ||
                    document.querySelector(`table[id="${cardId}"]`)?.closest('.card');

            if (card) {
                if (card.style.display === 'none') clearAllFilters();
                card.scrollIntoView({behavior:'smooth', block:'center'});
                card.style.transition = 'background-color 0.5s';
                card.style.backgroundColor = '#ffffcc';
                setTimeout(() => card.style.backgroundColor = '', 2000);
            }
        }, 300);
    };

    // Enhanced UI components
    const createFilterGroup = ({title, items, filterType, columns = 3, width}) => {
        const group = document.createElement('div');
        group.className = `filter-group ${filterType}-filter-group`;
        group.style.cssText = `
            display: flex;
            flex-direction: column;
            flex: 1;
            ${width ? `width: ${width}px; max-width: ${width}px;` : 'max-width: 200px;'}
            padding: 2px 5px;
            margin: 0 4px;
        `;

        // Title header
        const header = document.createElement('div');
        header.style.cssText = 'font-size:10px;font-weight:bold;margin-bottom:2px;white-space:nowrap;color:#444;';
        header.textContent = title;
        group.appendChild(header);

        // Button grid container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(${columns}, 1fr);
            gap: 4px;
            flex: 1;
        `;

        items.forEach(item => {
            const button = document.createElement('button');
            button.className = 'filter-btn';
            button.dataset.filter = item.id;
            button.dataset.filterType = filterType;

            // Check if filter is active
            const isActive =
                (filterType === 'type' && savedFilterState.activeTypeFilters.includes(item.id)) ||
                (filterType === 'category' && savedFilterState.activeCategoryFilters.includes(item.id)) ||
                (filterType === 'rarity' && savedFilterState.activeRarityFilters.includes(item.id));

            if (isActive) button.classList.add('active');

            // Button styling
            button.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1px 3px;
                font-size: 9px;
                border: none;
                background: ${isActive ? item.color : '#f8f8f8'};
                color: ${isActive ? '#fff' : '#333'};
                border-left: 2px solid ${item.color};
                border-radius: 2px;
                cursor: pointer;
                transition: all 0.2s;
                white-space: nowrap;
                min-height: 16px;
                box-shadow: ${isActive ? '0 1px 2px rgba(0,0,0,0.2)' : '0 1px 1px rgba(0,0,0,0.1)'};
            `;

            // Main label
            const label = document.createElement('span');
            // Shorten display names for some items
            const displayLabel = item.id === 'premium' ? 'プレミアム' :
                                item.id === 'campaign' ? 'キャンペーン' :
                                item.id === 'accessory' ? 'アクセ' :
                                item.id === 'topsbottoms' ? 'トップ&ボトム' :
                                item.label;

            label.textContent = displayLabel;
            label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;font-weight:bold;';

            // Counter badge
            const counter = document.createElement('span');
            counter.className = 'filter-count';
            counter.textContent = '0';
            counter.style.cssText = `
                background: ${isActive ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.1)'};
                border-radius: 8px;
                padding: 0 3px;
                font-size: 9px;
                min-width: 16px;
                text-align: center;
                margin-left: 2px;
            `;

            button.append(label, counter);

            // Button hover effects
            button.addEventListener('mouseover', function() {
                if (!this.classList.contains('active')) {
                    this.style.backgroundColor = '#f0f0f0';
                } else {
                    this.style.filter = 'brightness(1.1)';
                }
                this.style.transform = 'translateY(-1px)';
                this.style.boxShadow = '0 2px 5px rgba(0,0,0,0.15)';
            });

            button.addEventListener('mouseout', function() {
                if (!this.classList.contains('active')) {
                    this.style.backgroundColor = '#f8f8f8';
                } else {
                    this.style.filter = 'brightness(1)';
                }
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = this.classList.contains('active') ?
                    '0 1px 3px rgba(0,0,0,0.2)' : '0 1px 2px rgba(0,0,0,0.1)';
            });

            button.addEventListener('click', function() {
                this.classList.toggle('active');
                const isNowActive = this.classList.contains('active');

                this.style.backgroundColor = isNowActive ? item.color : '#f8f8f8';
                this.style.color = isNowActive ? '#fff' : '#333';
                this.style.boxShadow = isNowActive ? '0 1px 3px rgba(0,0,0,0.2)' : '0 1px 2px rgba(0,0,0,0.1)';
                this.querySelector('.filter-count').style.backgroundColor =
                    isNowActive ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.1)';

                updateFilterState();
                isSimpleView ? applyAllFilters() : applyDetailFilters();
            });

            buttonsContainer.appendChild(button);
        });

        group.appendChild(buttonsContainer);
        return group;
    };

    const createEnhancedHeader = () => {
        const header = document.querySelector('header.header');
        if (!header) return;

        header.style.height = '131px';

        // Main enhanced UI container
        const enhancedUI = document.createElement('div');
        enhancedUI.id = 'aikatsu-enhanced-ui';
        enhancedUI.style.cssText = `
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 1049px;
            max-width: 100%;
            background: linear-gradient(to bottom, rgb(255,160,190), rgb(252,143,181));
            box-shadow: 0 1px 5px rgba(0,0,0,0.15);
            z-index: 1000;
            padding: 5px 8px;
            display: flex;
            flex-wrap: nowrap;
            gap: 8px;
            align-items: stretch;
            font-family: "メイリオ", Meiryo, sans-serif;
            font-size: 12px;
            height: 120px;
            overflow: hidden;
        `;

        // Left zone - Logo and basic navigation
        const leftZone = document.createElement('div');
        leftZone.className = 'ui-left-zone';
        leftZone.style.cssText = `
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-width: 120px;
            max-width: 120px;
            flex: 0 0 auto;
        `;

        const logoLink = header.querySelector('.gnavi_logo');
        if (logoLink) {
            const clonedLogo = logoLink.cloneNode(true);
            clonedLogo.style.cssText = 'margin:0;padding:0;display:block;';
            const logoImg = clonedLogo.querySelector('img');
            if (logoImg) logoImg.style.cssText = 'height:65px;width:auto;';
            leftZone.appendChild(clonedLogo);
        }

        const navLinks = document.createElement('div');
        navLinks.style.cssText = 'display:flex;gap:10px;margin-top:3px;';

        ['カードリスト', 'グッズ'].forEach((text, i) => {
            const a = document.createElement('a');
            a.href = i === 0 ? '/cardlist/' : '/goods/';
            a.textContent = text;
            a.style.cssText = `
                color: white;
                text-decoration: none;
                font-weight: ${i === 0 ? 'bold' : 'normal'};
                font-size: 11px;
                position: relative;
                ${i === 0 ? 'border-bottom:2px solid white;padding-bottom:2px;' : ''}
            `;
            navLinks.appendChild(a);
        });

        leftZone.appendChild(navLinks);

        // Ownership zone
        const ownZone = document.createElement('div');
        ownZone.className = 'ui-own-zone';
        ownZone.style.cssText = `
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: rgba(255,255,255,0.5);
            border-radius: 5px;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 5px;
            width: 120px;
            flex: 0 0 auto;
        `;

        const collectionStats = document.createElement('div');
        collectionStats.id = 'collection-stats';
        collectionStats.style.cssText = 'font-size:11px;color:#333;text-align:left;font-weight:bold;padding-left:5px;';
        ownZone.appendChild(collectionStats);

        const ownershipOptions = document.createElement('div');
        ownershipOptions.style.cssText = 'display:flex;gap:3px;justify-content:center;';

        const filterOptions = [
            { id: 'all', label: '全て', color: '#aaa' },
            { id: 'owned', label: '所持', color: '#5cb85c' },
            { id: 'missing', label: '未所持', color: '#d9534f' }
        ];

        filterOptions.forEach(option => {
            const button = document.createElement('button');
            button.className = `ownership-filter-btn ${option.id === savedFilterState.activeOwnershipFilter ? 'active' : ''}`;
            button.dataset.filter = option.id;
            button.textContent = option.label;
            button.style.cssText = `
                padding: 2px 0;
                font-size: 10px;
                border: none;
                background: ${option.id === savedFilterState.activeOwnershipFilter ? option.color : '#f5f5f5'};
                color: ${option.id === savedFilterState.activeOwnershipFilter ? 'white' : '#333'};
                border-radius: 12px;
                cursor: pointer;
                flex: 1;
                transition: all 0.2s;
            `;

            button.addEventListener('click', function() {
                document.querySelectorAll('.ownership-filter-btn').forEach(btn => {
                    const optColor = filterOptions.find(opt => opt.id === btn.dataset.filter)?.color;
                    btn.classList.remove('active');
                    btn.style.backgroundColor = '#f5f5f5';
                    btn.style.color = '#333';
                });

                this.classList.add('active');
                this.style.backgroundColor = option.color;
                this.style.color = 'white';

                savedFilterState.activeOwnershipFilter = option.id;
                isSimpleView ? applyAllFilters() : applyDetailFilters();
            });

            ownershipOptions.appendChild(button);
        });

        ownZone.appendChild(ownershipOptions);

        const collectionButtons = document.createElement('div');
        collectionButtons.style.cssText = 'display:flex;width:100%;gap:3px;';

        const btnStyles = 'flex:1;padding:3px 0;font-size:10px;color:white;border:none;border-radius:3px;cursor:pointer;';

        const exportButton = document.createElement('button');
        exportButton.textContent = 'エクスポート';
        exportButton.style.cssText = `${btnStyles}background:#5bc0de;`;
        exportButton.addEventListener('click', exportOwnedCards);

        const importButton = document.createElement('button');
        importButton.textContent = 'インポート';
        importButton.style.cssText = `${btnStyles}background:#f0ad4e;`;
        importButton.addEventListener('click', importOwnedCards);

        const clearOwnedButton = document.createElement('button');
        clearOwnedButton.textContent = '全クリア';
        clearOwnedButton.style.cssText = `${btnStyles}background:#d9534f;`;
        clearOwnedButton.addEventListener('click', clearAllOwnedCards);

        collectionButtons.append(exportButton, importButton, clearOwnedButton);
        ownZone.appendChild(collectionButtons);

        // Center zone (main filters)
        const centerZone = document.createElement('div');
        centerZone.className = 'ui-center-zone';
        centerZone.style.cssText = `
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            gap: 2px;
            padding: 4px;
            background: rgba(255,255,255,0.6);
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.3);
            max-width: 635px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            overflow: hidden;
        `;

        // Filter groups container
        const filterContainer = document.createElement('div');
        filterContainer.style.cssText = `
            display: flex;
            justify-content: center;
            margin-bottom: 2px;
            width: 100%;
            padding: 0 2px;
        `;

        // Add filter groups
        filterContainer.append(
            createFilterGroup({
                title: 'タイプ',
                items: [
                    { id: 'cute', label: 'キュート', color: '#FDA7C1' },
                    { id: 'cool', label: 'クール', color: '#4977AE' },
                    { id: 'sexy', label: 'セクシー', color: '#8F57A0' },
                    { id: 'pop', label: 'ポップ', color: '#FF9900' }
                ],
                filterType: 'type',
                columns: 2,
                width: 124
            }),
            createFilterGroup({
                title: 'カテゴリー',
                items: [
                    { id: 'tops', label: 'トップス', color: '#66CC99' },
                    { id: 'bottoms', label: 'ボトムス', color: '#66CC99' },
                    { id: 'shoes', label: 'シューズ', color: '#66CC99' },
                    { id: 'accessory', label: 'アクセ', color: '#66CC99' },
                    { id: 'topsbottoms', label: 'トップ&ボトム', color: '#66CC99' }
                ],
                filterType: 'category',
                columns: 2,
                width: 170
            }),
            createFilterGroup({
                title: 'レアリティ',
                items: [
                    { id: 'normal', label: 'ノーマル', color: '#aaaaaa' },
                    { id: 'rare', label: 'レア', color: '#5d93e1' },
                    { id: 'premium', label: 'PR', color: '#FF9900' },
                    { id: 'campaign', label: 'CP', color: '#FF3366' },
                    { id: 'none', label: '-', color: '#dddddd' }
                ],
                filterType: 'rarity',
                columns: 3,
                width: 204
            })
        );

        centerZone.appendChild(filterContainer);

        // Search bar
        const searchBar = document.createElement('div');
        searchBar.style.cssText = `
            display: flex;
            align-items: center;
            gap: 3px;
            margin-top: 1px;
            height: 20px;
        `;

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = 'enhanced-search-input';
        searchInput.placeholder = 'カード名またはID検索...';
        searchInput.style.cssText = `
            flex: 1;
            padding: 1px 6px;
            border: 1px solid #FDA7C1;
            border-radius: 10px;
            font-size: 10px;
            height: 15px;
            box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
            transition: all 0.2s;
            min-width: 0;
        `;
        searchInput.value = savedFilterState.searchTerm || '';
        searchInput.addEventListener('input', function() {
            savedFilterState.searchTerm = this.value.toLowerCase();
            isSimpleView ? applyAllFilters() : applyDetailFilters();
        });
        searchInput.addEventListener('focus', function() {
            this.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.05), 0 0 4px rgba(255,105,156,0.3)';
        });
        searchInput.addEventListener('blur', function() {
            this.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.05)';
        });

        const clearButton = document.createElement('button');
        clearButton.textContent = 'クリア';
        clearButton.style.cssText = `
            background: linear-gradient(to bottom, #f8f8f8, #e8e8e8);
            border: 1px solid #ddd;
            border-radius: 3px;
            padding: 0px 4px;
            font-size: 9px;
            height: 16px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s;
            flex-shrink: 0;
        `;
        clearButton.addEventListener('click', clearAllFilters);
        clearButton.addEventListener('mouseover', function() {
            this.style.background = 'linear-gradient(to bottom, #ffffff, #f0f0f0)';
        });
        clearButton.addEventListener('mouseout', function() {
            this.style.background = 'linear-gradient(to bottom, #f8f8f8, #e8e8e8)';
        });

        const cardCount = document.createElement('span');
        cardCount.id = 'card-count-display';
        cardCount.textContent = '表示: 0枚';
        cardCount.style.cssText = `
            font-size: 9px;
            color: #666;
            min-width: 50px;
            text-align: right;
            white-space: nowrap;
            flex-shrink: 0;
        `;

        searchBar.append(searchInput, clearButton, cardCount);
        centerZone.appendChild(searchBar);

        // Right zone
        const rightZone = document.createElement('div');
        rightZone.className = 'ui-right-zone';
        rightZone.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 5px;
            align-items: stretch;
            padding: 5px;
            background: rgba(255,255,255,0.5);
            border-radius: 5px;
            border: 1px solid rgba(255,255,255,0.3);
            width: 130px;
            flex: 0 0 auto;
        `;

        const viewToggle = document.createElement('button');
        viewToggle.id = 'toggle-view-mode';
        viewToggle.textContent = 'シンプル表示に切替';
        viewToggle.style.cssText = `
            width: 100%;
            padding: 4px 0;
            background: linear-gradient(to bottom, #FFDAE9, #FF7BAC);
            border: 1px solid #FF5A99;
            border-radius: 4px;
            color: #fff;
            font-weight: bold;
            font-size: 11px;
            cursor: pointer;
            text-shadow: 0 1px 0 rgba(0,0,0,0.2);
        `;
        viewToggle.addEventListener('click', toggleSimpleView);

        const displaySettings = document.createElement('div');
        displaySettings.id = 'display-settings';
        displaySettings.style.cssText = 'width:100%;display:none;flex-direction:column;gap:5px;';

        const sizeControl = document.createElement('div');
        sizeControl.style.cssText = 'display:flex;flex-direction:column;width:100%;';

        sizeControl.innerHTML = `
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;">
                <span>カードサイズ:</span><span id="card-size-value">${userSettings.cardSize}px</span>
            </div>
            <input type="range" min="120" max="300" step="10" value="${userSettings.cardSize}" style="width:100%;accent-color:#FF7BAC;">
        `;

        sizeControl.querySelector('input').addEventListener('input', function() {
            const newSize = parseInt(this.value);
            document.getElementById('card-size-value').textContent = `${newSize}px`;
            userSettings.cardSize = newSize;
            GM_setValue('cardSize', newSize);
            if (isSimpleView) updateSimpleViewStyles();
        });

        // Full width toggle
        const fullWidthToggleContainer = document.createElement('div');
        fullWidthToggleContainer.style.cssText = 'display:flex;align-items:center;';
        fullWidthToggleContainer.innerHTML = `
            <input type="checkbox" id="full-width-toggle" style="margin-right:5px;accent-color:#FF7BAC;" ${userSettings.fullWidth ? 'checked' : ''}>
            <label for="full-width-toggle" style="font-size:10px;color:#666;line-height:1.2;">画面いっぱいに表示</label>
        `;

        fullWidthToggleContainer.querySelector('#full-width-toggle')?.addEventListener('change', function() {
            userSettings.fullWidth = this.checked;
            GM_setValue('fullWidth', this.checked);
            if (isSimpleView) adjustLayoutStructure(this.checked);
        });

        displaySettings.append(sizeControl, fullWidthToggleContainer);
        rightZone.append(viewToggle, displaySettings);

        // Assemble layout
        enhancedUI.append(leftZone, ownZone, centerZone, rightZone);
        header.appendChild(enhancedUI);

        const mgHead = document.querySelector('.mgHead');
        if (mgHead) mgHead.style.paddingTop = '140px';

        updateCollectionStats();
        return enhancedUI;
    };

    // Data import/export functions
    const exportOwnedCards = () => {
        const ownedCardData = [];

        document.querySelectorAll('.card').forEach(card => {
            const img = card.querySelector('.td-cardimg img');
            if (img && userSettings.ownedCards[img.getAttribute('src')]) {
                const imagePath = img.getAttribute('src');
                const match = imagePath.match(/\/([^/]+)\.png$/);
                if (match && match[1]) {
                    const fileName = match[1];
                    const cardName = extractCardName(card);
                    const cardId = extractCardId(card);

                    if (fileName && cardName && cardId) {
                        ownedCardData.push({ fileName, cardName, cardId });
                    }
                }
            }
        });

        // Add comments to CSV header
        const commentLines = [
            '# アイカツカードコレクションデータ',
            '# ※インポート時にはImageFileNameのみが必要です。CardNameとIDは参照用です。',
            '# ※画像ファイル名での管理について:',
            '# 　同一IDでも異なる画像が存在する場合があります。例:',
            '# 　・ID「14 04-CP01」は「サマーデイムーンドレス」のサインなし版(1404-CP01.png)と',
            '# 　　サインあり版(1404-CP01_81429.png)が存在',
            '# 　・「クリアガラストップス(PC-086_70802.png)」と「レースソックスつきピンクパンプス',
            '# 　　(PC-086_70962.png)」は同じID「PC-086」',
            '# 　そのため、実際に所持しているカードと画像が一致するように、画像ファイル名での管理が最適です。'
        ];

        // CSV header
        const headerLine = 'ImageFileName,CardName,ID';

        // Generate data lines (sorted by filename)
        ownedCardData.sort((a, b) => a.fileName.localeCompare(b.fileName));
        const dataLines = ownedCardData.map(card =>
            `${card.fileName},${card.cardName.replace(/,/g, '\\,')},${card.cardId}`
        );

        // Combine CSV content
        const csvContent = [...commentLines, headerLine, ...dataLines].join('\n');

        // Download as file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'aikatsu_collection.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        document.body.insertAdjacentHTML('beforeend', `<div id="copy-notification">カードリストをCSVファイルとしてエクスポートしました！</div>`);
        setTimeout(() => {
            document.getElementById('copy-notification').style.opacity = '0';
            setTimeout(() => document.getElementById('copy-notification')?.remove(), 300);
        }, 2000);
    };

    const importOwnedCards = () => {
        const overlay = document.createElement('div');
        overlay.id = 'dialog-overlay';

        const dialog = document.createElement('div');
        dialog.id = 'import-dialog';
        dialog.innerHTML = `
            <h3 style="margin:0 0 10px;font-size:16px;font-weight:bold;color:#555;">所持データインポート</h3>
            <p style="font-size:13px;margin-bottom:5px;color:#666;">カード画像ファイル名のリストまたはCSVをインポートします</p>
            <p style="font-size:12px;color:#666;margin-bottom:10px;">
                CSVの場合、最初の列（画像ファイル名）のみが使用されます<br>
                例: 1604-01.png または単に 1604-01
            </p>
            <textarea id="import-data-textarea" placeholder="1604-01&#10;1604-02&#10;1604-03"></textarea>
            <p style="font-size:12px;color:#666;margin:5px 0;">または</p>
            <input type="file" id="import-file-input" accept=".csv,.txt" style="margin-bottom:10px;">
            <div class="dialog-buttons">
                <button class="cancel-btn">キャンセル</button>
                <button class="import-btn">インポート</button>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        document.getElementById('import-data-textarea').focus();

        // Auto-load file content when selected
        document.getElementById('import-file-input').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById('import-data-textarea').value = e.target.result;
                };
                reader.readAsText(file);
            }
        });

        dialog.querySelector('.cancel-btn').addEventListener('click', () => {
            overlay.remove();
            dialog.remove();
        });

        dialog.querySelector('.import-btn').addEventListener('click', () => {
            const importData = document.getElementById('import-data-textarea').value.trim();
            if (!importData) {
                alert('インポートするデータを入力してください。');
                return;
            }

            try {
                // Process CSV or simple list
                const lines = importData.split(/\r?\n/).filter(line => line.trim() !== '' && !line.startsWith('#'));
                const cardBaseNames = [];

                lines.forEach(line => {
                    // For CSV, use only the first column (filename)
                    const parts = line.split(',');
                    let fileName = parts[0].trim();

                    // Remove .png extension if present
                    if (fileName.endsWith('.png')) {
                        fileName = fileName.substring(0, fileName.length - 4);
                    }

                    if (fileName) {
                        cardBaseNames.push(fileName);
                    }
                });

                const imagePaths = {};
                document.querySelectorAll('.card .td-cardimg img').forEach(img => {
                    const src = img.getAttribute('src');
                    if (src) {
                        const match = src.match(/\/([^/]+)\.png$/);
                        if (match && match[1]) {
                            imagePaths[match[1]] = src;
                        }
                    }
                });

                const newOwnedCards = { ...userSettings.ownedCards };
                let importedCount = 0;

                cardBaseNames.forEach(baseName => {
                    if (imagePaths[baseName]) {
                        newOwnedCards[imagePaths[baseName]] = true;
                        importedCount++;
                    } else {
                        // Try partial matching
                        for (const path in imagePaths) {
                            if (path.includes(baseName) || baseName.includes(path)) {
                                newOwnedCards[imagePaths[path]] = true;
                                importedCount++;
                                break;
                            }
                        }
                    }
                });

                userSettings.ownedCards = newOwnedCards;
                GM_setValue('ownedCards', userSettings.ownedCards);

                updateAllCardsOwnershipStatus();
                updateCollectionStats();

                if (isSimpleView) {
                    applyAllFilters();
                } else {
                    applyDetailFilters();
                }

                document.body.insertAdjacentHTML('beforeend', `<div id="copy-notification">${importedCount}枚のカードデータを正常にインポートしました！</div>`);
                setTimeout(() => {
                    document.getElementById('copy-notification').style.opacity = '0';
                    setTimeout(() => document.getElementById('copy-notification')?.remove(), 300);
                }, 2000);

                overlay.remove();
                dialog.remove();
            } catch (e) {
                alert('データの読み込みに失敗しました。');
                console.error('Import error:', e);
            }
        });
    };

    const clearAllOwnedCards = () => {
        const overlay = document.createElement('div');
        overlay.id = 'dialog-overlay';

        const dialog = document.createElement('div');
        dialog.id = 'import-dialog';
        dialog.innerHTML = `
            <h3 style="margin:0 0 10px;font-size:16px;font-weight:bold;color:#555;">所持データをクリア</h3>
            <p style="font-size:13px;margin-bottom:15px;color:#d9534f;font-weight:bold;">⚠️ 注意: この操作はすべての所持状態を削除します</p>
            <p style="font-size:13px;margin-bottom:15px;color:#666;">本当にすべてのカードの所持状態をクリアしますか？この操作は元に戻せません。</p>
            <div class="dialog-buttons">
                <button class="cancel-btn" style="padding:5px 15px;background:#f5f5f5;color:#333;border:none;border-radius:4px;cursor:pointer;">キャンセル</button>
                <button class="clear-btn" style="padding:5px 15px;background:#d9534f;color:white;border:none;border-radius:4px;cursor:pointer;margin-left:10px;">クリアする</button>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        dialog.querySelector('.cancel-btn').addEventListener('click', () => {
            overlay.remove();
            dialog.remove();
        });

        dialog.querySelector('.clear-btn').addEventListener('click', () => {
            userSettings.ownedCards = {};
            GM_setValue('ownedCards', userSettings.ownedCards);

            updateAllCardsOwnershipStatus();
            updateCollectionStats();

            if (isSimpleView) {
                applyAllFilters();
            } else {
                applyDetailFilters();
            }

            document.body.insertAdjacentHTML('beforeend', `<div id="copy-notification">所持データをすべてクリアしました</div>`);
            setTimeout(() => {
                document.getElementById('copy-notification').style.opacity = '0';
                setTimeout(() => document.getElementById('copy-notification')?.remove(), 300);
            }, 2000);

            overlay.remove();
            dialog.remove();
        });
    };

    // Card detail view functions
    const addCopyFunctionToDetailCards = () => {
        document.querySelectorAll('.card').forEach(card => {
            const id = extractCardId(card);
            const name = extractCardName(card);
            const img = card.querySelector('.td-cardimg img');
            const tdCardimg = card.querySelector('.td-cardimg');

            // Make card name clickable
            for (const selector of ['.ltd.tit-cute', '.ltd.tit-cool', '.ltd.tit-sexy', '.ltd.tit-accessory', '.ltd.tit-pop']) {
                const titleElem = card.querySelector(selector);
                if (titleElem?.nextElementSibling) {
                    const nameCell = titleElem.nextElementSibling;
                    if (nameCell.textContent.trim() !== '') {
                        const originalText = nameCell.textContent;
                        nameCell.innerHTML = `<span class="clickable-text card-name-text">${originalText}</span>`;
                        nameCell.querySelector('.clickable-text').addEventListener('click', e => {
                            e.stopPropagation();
                            copyTextToClipboard(originalText);
                        });
                    }
                    break;
                }
            }

            // Make card ID clickable
            const thElement = card.querySelector('th');
            if (thElement && id) {
                const idRegex = /^([^<]+)/;
                const match = thElement.innerHTML.match(idRegex);

                if (match) {
                    const originalHTML = thElement.innerHTML;
                    const idText = match[1].trim();
                    thElement.innerHTML = originalHTML.replace(idRegex, `<span class="clickable-text card-id-text">${idText}</span>`);
                    thElement.querySelector('.card-id-text').addEventListener('click', e => {
                        e.stopPropagation();
                        copyTextToClipboard(idText);
                    });
                }
            }

            // Set up ownership toggle for card image
            if (img && tdCardimg) {
                const imagePath = extractCardImagePath(card);
                if (imagePath) {
                    const isOwned = userSettings.ownedCards[imagePath];

                    if (isOwned) {
                        tdCardimg.classList.add('owned-card');
                        tdCardimg.classList.remove('not-owned-card');
                    } else {
                        tdCardimg.classList.remove('owned-card');
                        tdCardimg.classList.add('not-owned-card');
                    }

                    tdCardimg.style.position = 'relative';
                    tdCardimg.style.cursor = 'pointer';
                    img.title = isOwned ? 'クリックで未所持に変更' : 'クリックで所持済みに変更';

                    // Remove existing ownership icon (to prevent duplicates)
                    const existingIcon = card.querySelector('.ownership-detail-icon');
                    if (existingIcon) existingIcon.remove();

                    tdCardimg.addEventListener('click', e => {
                        e.stopPropagation();
                        toggleCardOwnership(imagePath, tdCardimg);
                    });
                }
            }
        });
    };

    // CSS styles
    const addEnhancedStyles = () => {
        document.head.insertAdjacentHTML('beforeend', `<style id="enhanced-ui-styles">
            body.simple-view-mode #list,body.simple-view-mode #search,body.simple-view-mode .btn_checklist,body.simple-view-mode .notice_aktphone,body.simple-view-mode .paginator{display:none!important}
            body.full-width-mode #mainCol{width:100%!important;max-width:none!important;float:none!important;background:white!important;box-shadow:0 0 20px rgba(255,123,172,.2)!important;padding:20px!important;border-radius:10px!important;margin-top:20px!important}
            body.full-width-mode #subCol{display:none!important}
            body.full-width-mode #wrapper-cardlist,body.full-width-mode #wrapCol{width:100%!important;background:none!important}
            #copy-notification{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background-color:rgba(255,105,156,.9);color:white;padding:10px 15px;border-radius:20px;font-weight:bold;box-shadow:0 2px 10px rgba(0,0,0,.2);z-index:10000;font-family:"メイリオ",Meiryo,sans-serif;font-size:13px;transition:opacity .3s ease}
            #simple-view{display:flex;flex-wrap:wrap;justify-content:center;gap:15px;margin:20px auto;width:100%;padding:10px;box-sizing:border-box;background-color:white}
            #end-message{text-align:center;padding:20px;margin:20px auto;font-weight:bold;color:#666;width:100%;border-top:1px dashed #ccc}
            #import-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;max-width:500px;background:white;padding:20px;border-radius:8px;box-shadow:0 0 20px rgba(0,0,0,.3);z-index:10001;font-family:"メイリオ",Meiryo,sans-serif}
            #import-dialog textarea{width:100%;height:120px;margin:10px 0;padding:8px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:12px}
            #import-dialog .dialog-buttons{display:flex;justify-content:flex-end;gap:10px;margin-top:15px}
            #import-dialog .dialog-buttons button{padding:5px 15px;border:none;border-radius:4px;cursor:pointer}
            #import-dialog .cancel-btn{background:#f5f5f5;color:#333}
            #import-dialog .import-btn{background:#5bc0de;color:white}
            #dialog-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000}
            #toggle-ownership{position:absolute;top:10px;left:10px;background:rgba(255,255,255,.8);border:1px solid rgba(128,128,128,.3);border-radius:50%;width:24px;height:24px;display:flex;justify-content:center;align-items:center;cursor:pointer;font-size:14px;color:#666;z-index:5}
            #toggle-ownership:hover{background:rgba(255,255,255,1);color:#333}
            .ownership-circle{display:flex;justify-content:center;align-items:center;width:20px;height:20px;border-radius:50%;font-weight:bold;font-size:10px;cursor:pointer}
            .owned-card .ownership-circle{background:#5cb85c;color:white;border:2px solid #4cae4c}
            .not-owned-card .ownership-circle{background:white;color:#d9534f;border:2px solid #d9534f}
            .owned-card img{box-shadow:0 0 0 4px #5cb85c!important}
            .td-cardimg img{cursor:pointer}
            .paginator{display:none!important}
            .clickable-text{cursor:pointer;position:relative;display:inline-block;transition:all 0.2s;text-decoration:underline;text-underline-offset:2px}
            .clickable-text:hover{color:#FF6699}
            .clickable-text::after{content:"📋";font-size:11px;margin-left:3px}
            .card-id-text, .card-name-text{cursor:pointer;transition:all 0.2s;text-decoration:underline;text-underline-offset:2px}
            .card-id-text:hover, .card-name-text:hover{color:#FF6699}
            .card-id-text::after, .card-name-text::after{content:"📋";font-size:10px;margin-left:3px}
            .td-cardimg{transition:all 0.2s;position:relative}
            .td-cardimg img:hover{opacity:0.85}
            .td-cardimg:hover::before{content:"クリックで所持状態を切替";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,0.9);padding:5px 8px;border-radius:3px;font-size:11px;white-space:nowrap;z-index:10;pointer-events:none}
            .owned-card .td-cardimg:hover::before{content:"クリックで未所持に変更"}
            .not-owned-card .td-cardimg:hover::before{content:"クリックで所持済みに変更"}
            .owned-card{position:relative}
            .card .owned-card::after{content:"✓";position:absolute;top:-5px;left:-5px;background:#5cb85c;color:white;width:24px;height:24px;border-radius:50%;display:flex;justify-content:center;align-items:center;font-weight:bold;z-index:5;border:2px solid white;font-size:12px}
            .simple-card.owned-card::after{display:none}
            @media screen and (max-width: 1200px) {
                #aikatsu-enhanced-ui {
                    width: 98%;
                    transform: translateX(-50%);
                    left: 50%;
                    flex-wrap: wrap;
                    height: auto;
                    max-height: 240px;
                }
                .ui-center-zone {
                    order: 4;
                    width: 100%;
                    max-width: 100%;
                }
                .filter-group {
                    max-width: 150px;
                }
                .header {
                    height: auto;
                    min-height: 131px;
                }
                .mgHead {
                    padding-top: 240px;
                }
            }
            .filter-btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
            }
            .filter-btn.active:hover {
                transform: translateY(-1px);
                filter: brightness(1.1);
            }
        </style>`);
    };

    // Pagination and initialization functions
    const disablePagination = () => {
        if (window.jQuery) {
            jQuery.fn.pagination = function() { return this; };
            jQuery('.paginator')?.remove();
        } else if (window.$) {
            $.fn.pagination = function() { return this; };
            $('.paginator')?.remove();
        }

        document.querySelectorAll('.card').forEach(card => card.style.display = '');

        const script = document.createElement('script');
        script.textContent = `
            if(window.jQuery)jQuery.fn.pagination=function(){return this};
            else if(window.$)$.fn.pagination=function(){return this};
            window.itemsPerPage=9999;window.paginatorStyle=0;
        `;
        document.head.appendChild(script);
    };

    const trackExistingCards = () => {
        document.querySelectorAll('.card').forEach(card => {
            const id = extractCardId(card);
            if (id) loadedCardIds.add(id);
        });
    };

    // Initialize the enhancement
    const init = () => {
        addEnhancedStyles();
        disablePagination();
        setTimeout(() => {
            document.querySelectorAll('.card').forEach(card => card.style.display = '');
            trackExistingCards();
            createEnhancedHeader();
            addCopyFunctionToDetailCards();
            setTimeout(() => {
                updateCardCount(document.querySelectorAll('.card').length);
                updateFilterCounts();
                updateCollectionStats();
            }, 500);
        }, 300);
    };

    // Start the script when elements are ready
    (function waitForElements() {
        if (document.querySelector('#list') && document.querySelectorAll('.card').length > 0) {
            init();
        } else {
            setTimeout(waitForElements, 100);
        }
    })();
})(); 