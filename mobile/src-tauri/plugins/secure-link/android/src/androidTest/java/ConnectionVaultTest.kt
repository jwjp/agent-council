package dev.agentcouncil.securelink

import android.content.Context
import android.security.NetworkSecurityPolicy
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConnectionVaultTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val prefs get() = context.getSharedPreferences("council_connection", Context.MODE_PRIVATE)
    private val keyStore get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias = "CouncilCompanionConnection"

    @Before
    @After
    fun clearFixture() {
        ConnectionVault(context).clear()
        keyStore.deleteEntry(alias)
    }

    @Test
    fun persistsEncryptedValueAndUpdatesAcrossInstances() {
        val vault = ConnectionVault(context)
        val fixture = "fixture-only-연결"
        assertNull(vault.load())
        vault.save(fixture)
        val first = prefs.getString("encrypted", null)!!
        assertFalse(Base64.decode(first, Base64.NO_WRAP).toString(Charsets.UTF_8).contains(fixture))
        val key = checkNotNull(keyStore.getKey(alias, null))
        assertNull(key.encoded)
        assertEquals(fixture, ConnectionVault(context).load())
        vault.save(fixture)
        assertNotEquals(first, prefs.getString("encrypted", null))
        ConnectionVault(context).save("updated-fixture")
        assertEquals("updated-fixture", vault.load())
    }

    @Test
    fun rejectsCorruptionAndClearsSavedValue() {
        val vault = ConnectionVault(context)
        vault.save("fixture")
        val encrypted = Base64.decode(prefs.getString("encrypted", null), Base64.NO_WRAP)
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        check(prefs.edit().putString("encrypted", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
        assertThrows(AEADBadTagException::class.java) { ConnectionVault(context).load() }
        vault.clear()
        assertNull(ConnectionVault(context).load())
        assertFalse(prefs.contains("encrypted"))
    }

    @Test
    fun rejectsInvalidSizeWithoutOverwriting() {
        val vault = ConnectionVault(context)
        vault.save("retained-fixture")
        assertThrows(IllegalArgumentException::class.java) { vault.save("") }
        assertThrows(IllegalArgumentException::class.java) { vault.save("한".repeat(3000)) }
        assertEquals("retained-fixture", ConnectionVault(context).load())
    }

    @Test
    fun blocksCleartextInAndroidNetworkPolicy() {
        assertFalse(NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted)
    }
}
