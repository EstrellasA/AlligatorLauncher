<script setup lang="ts">
import { defineMessages, injectNotificationManager, useVIntl } from '@modrinth/ui'
import { computed, inject, onUnmounted, type Ref, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { provideHomeDashboardRuntime } from '@/components/home/home-dashboard-runtime'
import { getActivePlayerAccount } from '@/components/home/home-utils'
import HomeCalendar from '@/components/home/HomeCalendar.vue'
import HomeGreeting from '@/components/home/HomeGreeting.vue'
import HomeInstancePickerModal from '@/components/home/HomeInstancePickerModal.vue'
import HomeMinimal from '@/components/home/HomeMinimal.vue'
import HomeServerStatus from '@/components/home/HomeServerStatus.vue'
import SkinAvatarEntry from '@/components/home/SkinAvatarEntry.vue'
import AccountsCard from '@/components/ui/AccountsCard.vue'
import { useNetworkStatus } from '@/composables/useNetworkStatus'
import { get_default_user, users } from '@/helpers/auth'
import { DIRECT_LINKS_SYNCED_EVENT } from '@/helpers/direct-link-sync'
import { instance_groups_listener, instance_listener } from '@/helpers/events'
import { list } from '@/helpers/instance'
import { get as getSettings, update as updateSettings } from '@/helpers/settings'
import { get_available_skins, get_normalized_skin_texture } from '@/helpers/skins'
import type { GameInstance } from '@/helpers/types'
import { useBreadcrumbs } from '@/store/breadcrumbs'
import { useTheming } from '@/store/state'

const { handleError } = injectNotificationManager()
const route = useRoute()
const router = useRouter()
const breadcrumbs = useBreadcrumbs()
const { formatMessage } = useVIntl()
const { offline } = useNetworkStatus()
const themeStore = useTheming()

const messages = defineMessages({
    home: { id: 'app.home.breadcrumb', defaultMessage: 'Home' },
})

breadcrumbs.setRootContext({ name: formatMessage(messages.home), link: route.path })

/**
 * The calendar panel reads the shared home runtime for `instanceRevision` (so it
 * reloads when an instance changes) and `runningInstanceIds` (so it can offer
 * Stop). This page owns that provider now, so it has to supply the runtime —
 * without it the widget throws on setup.
 */
provideHomeDashboardRuntime(handleError)

const instances = ref<GameInstance[]>([])
const playerName = ref<string | null>(null)
const skinTexture = ref<string | null>(null)
const skinVariant = ref<'CLASSIC' | 'SLIM'>('CLASSIC')
const instancePicker = ref<InstanceType<typeof HomeInstancePickerModal>>()
const accountsCardInstance = ref<InstanceType<typeof AccountsCard> | null>(null)
const skinAvatar = ref<InstanceType<typeof SkinAvatarEntry> | null>(null)

/**
 * AccountsCard is the shell's sign-in surface, so App.vue owns the instance and
 * shares it through the `accountsCard` provide. The home page is the only page
 * that renders the card, so it hands the mounted instance back to that shared
 * ref for as long as it stays on screen.
 */
const accountsCard = inject<Ref<InstanceType<typeof AccountsCard> | null> | null>(
    'accountsCard',
    null,
)
watch(
    accountsCardInstance,
    (instance) => {
        if (accountsCard) accountsCard.value = instance
    },
    { flush: 'sync' },
)

/**
 * The greeting name is read once per page, so it has to follow the account the
 * card switches to. AccountsCard owns that state and bumps a revision when it
 * changes; this is the same subscription the skins page uses.
 */
const accountChangeRevision = computed(() => accountsCard?.value?.accountChangeRevision)

watch(accountChangeRevision, (revision, previousRevision) => {
    if (revision === undefined || previousRevision === undefined) return
    void fetchPlayerName()
    void fetchSkinTexture()
})

async function clearMissingMinimalInstance() {
    const selectedId = themeStore.minimalHomeInstanceId
    if (!selectedId || instances.value.some((instance) => instance.id === selectedId)) return

    themeStore.minimalHomeInstanceId = null
    try {
        const settings = await getSettings()
        if (settings.minimal_home_instance_id === null) return
        await updateSettings({ minimal_home_instance_id: null })
    } catch (error) {
        handleError(error)
    }
}

async function fetchInstances() {
    try {
        instances.value = await list()
        await clearMissingMinimalInstance()
        return true
    } catch (error) {
        handleError(error)
        return false
    }
}

async function fetchPlayerName() {
    const selectedUser = await get_default_user(offline.value).catch(() => undefined)
    const accounts = await users(offline.value).catch(() => [])
    const account = getActivePlayerAccount(selectedUser, accounts)

    playerName.value = account?.name ?? null
}

/**
 * 首页左下角那个 3D 小人用的是玩家当前皮肤。
 * 取不到就保持 null，组件会退回内置史蒂夫皮肤，不会报错。
 */
async function fetchSkinTexture() {
    try {
        const skins = await get_available_skins()
        const equipped = skins.find((skin) => skin.is_equipped) ?? skins[0]
        if (!equipped) return

        skinVariant.value = equipped.variant === 'SLIM' ? 'SLIM' : 'CLASSIC'
        skinTexture.value = await get_normalized_skin_texture(equipped)
    } catch {
        // 未登录 / 后端未就绪时静默失败，交给组件的兜底贴图
    }
}

async function selectMinimalInstance(instance: GameInstance) {
    try {
        await updateSettings({ minimal_home_instance_id: instance.id })
        themeStore.minimalHomeInstanceId = instance.id
    } catch (error) {
        handleError(error)
    }
}

function createInstance() {
    void router.push('/create')
}

/**
 * The 3D avatar plays a short bounce before the skins page opens, so the click
 * has some feedback. The class lands on the component's own root element, which
 * keeps this out of `SkinAvatarEntry` and leaves its fixed position untouched.
 */
const SKIN_BOUNCE_MS = 240
let skinNavigationTimer = 0

function openSkinPage() {
    const element = skinAvatar.value?.$el as HTMLElement | undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!element || reduceMotion) {
        void router.push('/skins')
        return
    }

    element.classList.remove('home-skin-avatar-bounce')
    // Read the layout back so a repeated click restarts the animation.
    void element.offsetWidth
    element.classList.add('home-skin-avatar-bounce')

    window.clearTimeout(skinNavigationTimer)
    skinNavigationTimer = window.setTimeout(() => {
        element.classList.remove('home-skin-avatar-bounce')
        void router.push('/skins')
    }, SKIN_BOUNCE_MS)
}

const instancesLoaded = await fetchInstances()
if (!instancesLoaded || instances.value.length > 0) void fetchPlayerName()
void fetchSkinTexture()

window.addEventListener(DIRECT_LINKS_SYNCED_EVENT, fetchInstances)

const unlistenInstance = await instance_listener(async () => {
    await fetchInstances()
})
const unlistenInstanceGroups = await instance_groups_listener(async () => {
    await fetchInstances()
})

onUnmounted(() => {
    unlistenInstance()
    unlistenInstanceGroups()
    window.clearTimeout(skinNavigationTimer)
    window.removeEventListener(DIRECT_LINKS_SYNCED_EVENT, fetchInstances)
})
</script>

<template>
    <HomeInstancePickerModal
        ref="instancePicker"
        :instances="instances"
        :selected-instance-id="themeStore.minimalHomeInstanceId"
        @select="selectMinimalInstance"
    />
    <div class="home-page home-fixed-render relative flex h-full min-h-0 flex-col">
        <!-- Static brand glow: a central one behind the server card, a soft highlight top-right and a deeper one bottom-left. -->
        <div class="home-page-glow" aria-hidden="true" />

        <div
            class="home-content relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-6 px-6 pt-8"
        >
            <suspense>
                <AccountsCard ref="accountsCardInstance" />
            </suspense>

            <!-- 顶部：自定义问候语 -->
            <div class="home-stage home-stage--1 shrink-0">
                <HomeGreeting :player-name="playerName" variant="minimal" />
            </div>

            <!--
                中间：服务器状态卡（左 2/3）+ 日历（右 1/3）。
                只有这一段是弹性的：窗口变矮时它先让位，卡片内部自己滚动，
                页面本身永远不滚。窄窗口下两栏改为上下堆叠。
            -->
            <div class="home-stage home-stage--2 flex min-h-0 flex-1 flex-col">
                <div class="home-middle-row">
                    <div class="home-panel home-panel--server">
                        <HomeServerStatus
                            :instances="instances"
                            :selected-instance-id="themeStore.minimalHomeInstanceId"
                        />
                    </div>

                    <!--
                        日历面板：位于中间行右侧 1/3。
                        它必须自己撑满这一格的高度（内部滚动），
                        这样页面永远不会出现滚动条。
                    -->
                    <div class="home-panel home-panel--calendar">
                        <HomeCalendar :instances="instances" />
                    </div>
                </div>
            </div>

            <!-- 底部：实例选择 + 开始游戏（底边与左下角 3D 小人的脚底对齐） -->
            <div class="home-stage home-stage--3 shrink-0">
                <HomeMinimal
                    :instances="instances"
                    :selected-instance-id="themeStore.minimalHomeInstanceId"
                    @choose="instancePicker?.show()"
                    @create="createInstance"
                />
            </div>
        </div>
    </div>
    <SkinAvatarEntry
        ref="skinAvatar"
        :texture-src="skinTexture"
        :variant="skinVariant"
        @select="openSkinPage"
    />
</template>

<style scoped>
/*
 * The page is exactly one viewport tall; every region inside it is sized by the
 * flex column, so nothing can spill past the window.
 */
.home-page {
    overflow: hidden;
}

/*
 * Bottom baseline of the page: the instance card's bottom edge and the 3D
 * avatar's feet share it.
 *
 * The avatar widget is fixed at `bottom: 1rem` and carries `0.5rem` of its own
 * padding, so the bottom of its scene box sits 1.5rem above the window bottom.
 * The fitted model is drawn inside that box with its feet at 91% of the box's
 * height (modal framing, fit-zoom 1.25 — see use-skin-preview-fit.ts), i.e. 9%
 * of the box's 7.5rem above the box's bottom edge. Everything here is the
 * avatar's own geometry, so the two stay level without moving the widget.
 */
.home-content {
    --home-avatar-scene-height: 7.5rem;
    padding-bottom: calc(1.5rem + 0.09 * var(--home-avatar-scene-height));
}

/* Server card two thirds, calendar one third, side by side once there is room. */
.home-middle-row {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    gap: 1rem;
}

.home-panel {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1 1 0%;
    flex-direction: column;
}

/* The calendar panel paints its own glass surface, so this only sizes the cell. */
.home-panel--calendar {
    /* Keeps the mounted calendar from dragging the row taller than its band. */
    overflow: hidden;
}

@media (min-width: 640px) {
    .home-middle-row {
        flex-direction: row;
    }

    .home-panel--server {
        flex: 2 1 0%;
    }

    .home-panel--calendar {
        flex: 1 1 0%;
    }
}

.home-page-glow {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
        /* Sits behind the server card, which is what gives its blur something to
           pick up — without it the glass reads as a flat panel. */
        radial-gradient(
            34rem 24rem at 50% 46%,
            color-mix(in srgb, var(--color-brand) 15%, transparent),
            transparent 74%
        ),
        radial-gradient(
            38rem 26rem at 92% 0%,
            color-mix(in srgb, var(--color-brand) 13%, transparent),
            transparent 70%
        ),
        radial-gradient(
            36rem 26rem at 2% 100%,
            color-mix(in srgb, var(--color-purple) 11%, transparent),
            transparent 72%
        );
}

/* Greeting, server card and instance card arrive one after another.
   `backwards` (not `both`) so the finished element keeps no transform — a
   lingering transform would become a containing block for the glass cards. */
.home-stage {
    animation: home-stage-in 520ms cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

.home-stage--1 {
    animation-delay: 0ms;
}

.home-stage--2 {
    animation-delay: 80ms;
}

.home-stage--3 {
    animation-delay: 160ms;
}

@keyframes home-stage-in {
    from {
        opacity: 0;
        transform: translateY(14px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* Lives here, not in `SkinAvatarEntry`, so the widget's own styles stay intact. */
.home-skin-avatar-bounce {
    animation: home-skin-avatar-bounce 240ms ease-out;
}

@keyframes home-skin-avatar-bounce {
    0% {
        transform: translateY(0) scale(1);
    }
    35% {
        transform: translateY(-8px) scale(1.06);
    }
    70% {
        transform: translateY(2px) scale(0.98);
    }
    100% {
        transform: translateY(0) scale(1);
    }
}

@media (prefers-reduced-motion: reduce) {
    .home-stage {
        animation: none;
    }

    .home-skin-avatar-bounce {
        animation: none;
    }
}
</style>

<!--
    Not scoped: the element that actually scrolls is the shell's `.app-viewport`,
    which every other page relies on. The home page is a single fixed-height
    screen, so it opts out of that scroller instead, and gives the page-transition
    grid and layer a definite height for `h-full` to resolve against.

    The selectors carry an extra class so they outrank the shell's scoped
    `.app-viewport[data-v-…]` rule whatever order the two stylesheets land in.
-->
<style>
.app-viewport:has(.home-page.home-fixed-render) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    scrollbar-gutter: auto;
}

/* The unreachable-auth admonition is an in-flow sibling of the grid; as a flex
   item it takes its own height instead of pushing the page out of the pane. */
.app-viewport:has(.home-page.home-fixed-render) .page-transition-grid {
    flex: 1 1 0%;
    height: auto;
    min-height: 0;
}

.app-viewport:has(.home-page.home-fixed-render) .page-transition-layer {
    height: 100%;
    min-height: 0;
}
</style>
